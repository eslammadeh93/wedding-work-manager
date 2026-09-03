import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

const routesApiKey = defineSecret('GOOGLE_MAPS_ROUTES_API_KEY');
const options = {
  region: 'us-central1' as const,
  invoker: 'public' as const,
  enforceAppCheck: false,
  secrets: [routesApiKey],
};

type Request = { auth?: { uid: string; token?: Record<string, unknown> }; data: unknown };
type Member = { uid?: string; companyId?: string; status?: string; role?: string; permissions?: unknown };
type Coordinates = { latitude: number; longitude: number };

const isMapsHost = (hostname: string) => hostname === 'maps.app.goo.gl'
  || hostname === 'goo.gl'
  || hostname === 'google.com'
  || hostname.endsWith('.google.com');

const coordinatesFromValue = (value: string): Coordinates | null => {
  const match = value.match(/(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : null;
};

export const coordinatesFromMapsUrl = (value: string): Coordinates | null => {
  const decoded = decodeURIComponent(value);
  const direct = decoded.match(/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/)
    || decoded.match(/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
  if (direct) return coordinatesFromValue(`${direct[1]},${direct[2]}`);
  try {
    const url = new URL(value);
    return coordinatesFromValue(url.searchParams.get('query') || url.searchParams.get('q') || url.searchParams.get('destination') || '');
  } catch {
    return null;
  }
};

const mapsUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 2_000) {
    throw new HttpsError('invalid-argument', 'ضع رابط Google Maps صحيحًا للموقع.');
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !isMapsHost(url.hostname)) throw new Error('host');
    return url;
  } catch {
    throw new HttpsError('invalid-argument', 'يُقبل رابط Google Maps فقط. انسخ الرابط من تطبيق الخرائط ثم حاول مرة أخرى.');
  }
};

const resolveCoordinates = async (input: unknown) => {
  let url = mapsUrl(input);
  for (let redirects = 0; redirects < 6; redirects += 1) {
    const direct = coordinatesFromMapsUrl(url.href);
    if (direct) return direct;
    const response = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Wedding Work Manager transportation calculator' } });
    const location = response.headers.get('location');
    if (!location || response.status < 300 || response.status >= 400) break;
    url = new URL(location, url);
    if (url.protocol !== 'https:' || !isMapsHost(url.hostname)) break;
  }
  const finalCoordinates = coordinatesFromMapsUrl(url.href);
  if (finalCoordinates) return finalCoordinates;
  throw new HttpsError('invalid-argument', 'تعذر قراءة الإحداثيات من الرابط. افتح الموقع في Google Maps ثم انسخ رابط المشاركة الكامل وحاول مرة أخرى.');
};

const authorize = async (db: FirebaseFirestore.Firestore, auth: Request['auth']) => {
  const companyId = typeof auth?.token?.companyId === 'string' ? auth.token.companyId : '';
  if (!auth?.uid || !/^[A-Za-z0-9_-]{1,128}$/.test(companyId)) throw new HttpsError('unauthenticated', 'سجّل الدخول بحساب شركة نشط أولًا.');
  const companyRef = db.collection('companies').doc(companyId);
  const [company, memberSnapshot] = await Promise.all([companyRef.get(), companyRef.collection('members').doc(auth.uid).get()]);
  const member = memberSnapshot.data() as Member | undefined;
  const permissions = Array.isArray(member?.permissions) ? member.permissions : [];
  const allowed = member?.role === 'company_super_admin'
    || permissions.includes('company:calculator:use')
    || (!permissions.length && ['manager', 'employee'].includes(String(member?.role || '')));
  if (!company.exists || !['active', 'trial'].includes(String(company.data()?.status)) || !memberSnapshot.exists || member?.uid !== auth.uid || member.companyId !== companyId || member.status !== 'active' || !allowed) {
    throw new HttpsError('permission-denied', 'حساب الشركة غير مصرح له باستخدام حاسبة الانتقالات.');
  }
};

export const createTransportationFunctions = (db: FirebaseFirestore.Firestore) => ({
  calculateTransportationRoute: onCall(options, async (request: Request) => {
    await authorize(db, request.auth);
    const apiKey = routesApiKey.value();
    if (!apiKey) throw new HttpsError('failed-precondition', 'حاسبة الانتقالات غير مفعّلة بعد. أضف مفتاح Google Maps Routes API على الخادم.');
    const input = (request.data || {}) as { originUrl?: unknown; destinationUrl?: unknown };
    const [origin, destination] = await Promise.all([resolveCoordinates(input.originUrl), resolveCoordinates(input.destinationUrl)]);
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin: { location: { latLng: origin } },
        destination: { location: { latLng: destination } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        units: 'METRIC',
      }),
    });
    const data = await response.json() as { routes?: Array<{ distanceMeters?: unknown; duration?: unknown }> };
    const route = data.routes?.[0];
    const distanceMeters = Number(route?.distanceMeters);
    const durationSeconds = Number(String(route?.duration || '').replace(/s$/, ''));
    if (!response.ok || !Number.isFinite(distanceMeters) || distanceMeters < 0) {
      throw new HttpsError('failed-precondition', 'تعذر حساب الطريق. تأكد من تفعيل Routes API وصلاحية مفتاح Google Maps.');
    }
    return { distanceMeters, durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0 };
  }),
});
