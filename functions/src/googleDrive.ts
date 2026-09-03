import * as crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

const googleDriveClientId = defineSecret('GOOGLE_DRIVE_CLIENT_ID');
const googleDriveClientSecret = defineSecret('GOOGLE_DRIVE_CLIENT_SECRET');
const googleDriveTokenKey = defineSecret('GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY');
const driveScope = 'https://www.googleapis.com/auth/drive.file';
const connectionCollection = 'companyDriveConnections';
const uploadedFileCollection = 'uploadedFiles';
const options = {
  region: 'us-central1' as const,
  invoker: 'public' as const,
  enforceAppCheck: false,
  secrets: [googleDriveClientId, googleDriveClientSecret, googleDriveTokenKey],
};

type AuthContext = { uid: string; token?: Record<string, unknown> } | undefined;
type Request = { auth?: AuthContext; data: unknown };
type Member = { uid?: string; companyId?: string; status?: string; role?: string; permissions?: unknown };
type OAuthState = { companyId: string; uid: string; folderId: string; expiresAt: number; nonce: string };
type DriveConnection = { folderId?: string; refreshTokenEncrypted?: string };

const requiredMemberPermission = (member: Member, permission: 'company:settings:write' | 'company:orders:write') =>
  member.role === 'company_super_admin' || (Array.isArray(member.permissions) && member.permissions.includes(permission));

const callbackUrl = () => `https://us-central1-${process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'PROJECT_ID'}.cloudfunctions.net/googleDriveOAuthCallback`;

const configured = () => {
  const clientId = googleDriveClientId.value();
  const clientSecret = googleDriveClientSecret.value();
  const tokenKey = googleDriveTokenKey.value();
  if (!clientId || !clientSecret || !tokenKey) throw new HttpsError('failed-precondition', 'ربط Google Drive غير مُعَد بعد. أضف مفاتيح Google المطلوبة على السيرفر.');
  return { clientId, clientSecret, tokenKey };
};

const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
const decode = (value: string) => Buffer.from(value, 'base64url').toString('utf8');
const sign = (value: string, key: string) => crypto.createHmac('sha256', key).update(value).digest('base64url');

const encrypt = (plainText: string, key: string) => {
  const keyBytes = crypto.createHash('sha256').update(key).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
};

const decrypt = (encryptedValue: string, key: string) => {
  const [ivValue, tagValue, bodyValue] = encryptedValue.split('.');
  if (!ivValue || !tagValue || !bodyValue) throw new HttpsError('failed-precondition', 'بيانات ربط Google Drive غير صالحة. أعد الربط من الإعدادات.');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(key).digest(), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(bodyValue, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new HttpsError('failed-precondition', 'تعذر قراءة ربط Google Drive. أعد الربط من الإعدادات.');
  }
};

const folderIdFromUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 1000) throw new HttpsError('invalid-argument', 'رابط فولدر Google Drive غير صالح.');
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !['drive.google.com', 'www.drive.google.com'].includes(url.hostname)) throw new Error('host');
    const fromPath = url.pathname.match(/\/folders\/([A-Za-z0-9_-]{10,200})/);
    const id = fromPath?.[1] || url.searchParams.get('id') || '';
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw new Error('folder');
    return id;
  } catch {
    throw new HttpsError('invalid-argument', 'ضع رابط فولدر Google Drive صحيحًا.');
  }
};

const fileName = (value: unknown) => {
  const clean = typeof value === 'string' ? value.trim().replace(/[\\/:*?"<>|]/g, '_') : '';
  if (!clean || clean.length > 180) throw new HttpsError('invalid-argument', 'اسم الصورة غير صالح.');
  return clean;
};

const driveFileId = (value: unknown) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(value)) {
    throw new HttpsError('invalid-argument', 'معرّف صورة Google Drive غير صالح.');
  }
  return value;
};

const imageMimeType = (value: unknown) => {
  const type = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(type)) throw new HttpsError('invalid-argument', 'يسمح برفع صور JPG أو PNG أو WEBP أو HEIC فقط.');
  return type;
};

export const createGoogleDriveFunctions = (db: FirebaseFirestore.Firestore) => {
  const authorize = async (auth: AuthContext, permission: 'company:settings:write' | 'company:orders:write') => {
    const companyId = typeof auth?.token?.companyId === 'string' ? auth.token.companyId : '';
    if (!auth?.uid || !/^[A-Za-z0-9_-]{1,128}$/.test(companyId)) throw new HttpsError('unauthenticated', 'سجّل الدخول بحساب شركة نشط أولًا.');
    const companyRef = db.collection('companies').doc(companyId);
    const [company, member] = await Promise.all([companyRef.get(), companyRef.collection('members').doc(auth.uid).get()]);
    const data = member.data() as Member | undefined;
    if (!company.exists || !['active', 'trial'].includes(String(company.data()?.status)) || !member.exists || data?.uid !== auth.uid || data.companyId !== companyId || data.status !== 'active') throw new HttpsError('permission-denied', 'حساب الشركة غير نشط أو غير مصرح له.');
    if (!requiredMemberPermission(data, permission)) throw new HttpsError('permission-denied', 'ليس لديك الصلاحية المطلوبة لهذه العملية.');
    return { companyId, uid: auth.uid };
  };

  const authorizeState = async (state: OAuthState) => authorize({ uid: state.uid, token: { companyId: state.companyId } }, 'company:settings:write');

  const refreshAccessToken = async (companyId: string) => {
    const { clientId, clientSecret, tokenKey } = configured();
    const snapshot = await db.collection(connectionCollection).doc(companyId).get();
    const connection = snapshot.data() as DriveConnection | undefined;
    if (!connection?.folderId || !connection.refreshTokenEncrypted) throw new HttpsError('failed-precondition', 'لم يتم ربط Google Drive لهذه الشركة بعد.');
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: decrypt(connection.refreshTokenEncrypted, tokenKey), grant_type: 'refresh_token' }),
    });
    const data = await response.json() as { access_token?: string };
    if (!response.ok || !data.access_token) throw new HttpsError('failed-precondition', 'انتهت صلاحية ربط Google Drive أو تم إلغاؤه. أعد الربط من الإعدادات.');
    return { accessToken: data.access_token, folderId: connection.folderId };
  };

  return {
    beginGoogleDriveConnection: onCall(options, async (request: Request) => {
      const { companyId, uid } = await authorize(request.auth, 'company:settings:write');
      const { clientId, tokenKey } = configured();
      const folderId = folderIdFromUrl((request.data as { folderUrl?: unknown })?.folderUrl);
      const payload: OAuthState = { companyId, uid, folderId, expiresAt: Date.now() + 10 * 60_000, nonce: crypto.randomBytes(16).toString('base64url') };
      const encoded = encode(JSON.stringify(payload));
      const state = `${encoded}.${sign(encoded, tokenKey)}`;
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ client_id: clientId, redirect_uri: callbackUrl(), response_type: 'code', scope: driveScope, access_type: 'offline', prompt: 'consent', state }).toString();
      return { authorizationUrl: url.toString() };
    }),

    googleDriveOAuthCallback: onRequest(options, async (request, response) => {
      const fail = (message: string) => { response.status(400).type('html').send(`<!doctype html><html dir="rtl"><body style="font-family:sans-serif;padding:32px"><h2>تعذر ربط Google Drive</h2><p>${message}</p></body></html>`); };
      const code = typeof request.query.code === 'string' ? request.query.code : '';
      const stateValue = typeof request.query.state === 'string' ? request.query.state : '';
      if (!code || !stateValue) return fail('لم تكتمل عملية التفويض.');
      try {
        const { clientId, clientSecret, tokenKey } = configured();
        const [encoded, signature] = stateValue.split('.');
        if (!encoded || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(encoded, tokenKey)))) return fail('رابط التفويض غير صالح.');
        const state = JSON.parse(decode(encoded)) as OAuthState;
        if (!state || state.expiresAt < Date.now() || !/^[A-Za-z0-9_-]{1,128}$/.test(state.companyId) || !/^[A-Za-z0-9_-]{10,200}$/.test(state.folderId)) return fail('انتهت صلاحية طلب الربط. ابدأ من الإعدادات مرة أخرى.');
        await authorizeState(state);
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: callbackUrl(), grant_type: 'authorization_code' }),
        });
        const tokenData = await tokenResponse.json() as { refresh_token?: string };
        if (!tokenResponse.ok) throw new Error('token_exchange_failed');
        const connectionRef = db.collection(connectionCollection).doc(state.companyId);
        const existing = (await connectionRef.get()).data() as DriveConnection | undefined;
        const refreshToken = tokenData.refresh_token || (existing?.refreshTokenEncrypted ? decrypt(existing.refreshTokenEncrypted, tokenKey) : '');
        if (!refreshToken) return fail('لم يرسل Google صلاحية دائمة للرفع. أعد المحاولة ووافق على كل الصلاحيات المطلوبة.');
        await Promise.all([
          connectionRef.set({ folderId: state.folderId, refreshTokenEncrypted: encrypt(refreshToken, tokenKey), connectedBy: state.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
          db.doc(`companies/${state.companyId}/settings/main`).set({ googleDriveConnected: true, googleDriveFolderId: state.folderId, googleDriveConnectedAt: FieldValue.serverTimestamp() }, { merge: true }),
        ]);
        response.type('html').send('<!doctype html><html dir="rtl"><body style="font-family:sans-serif;padding:32px"><h2>تم ربط Google Drive بنجاح</h2><p>يمكنك إغلاق هذه النافذة والعودة إلى البرنامج.</p><script>window.opener?.postMessage({type:"google-drive-connected"}, "*"); window.close();</script></body></html>');
        return;
      } catch (error) {
        loggerError(error);
        return fail('حدث خطأ أثناء حفظ الربط. تأكد من صلاحيات الحساب والفولدر ثم أعد المحاولة.');
      }
    }),

    getGoogleDriveConnectionStatus: onCall(options, async (request: Request) => {
      const { companyId } = await authorize(request.auth, 'company:settings:write');
      const connection = await db.collection(connectionCollection).doc(companyId).get();
      return { connected: connection.exists && Boolean(connection.data()?.folderId) };
    }),

    disconnectGoogleDrive: onCall(options, async (request: Request) => {
      const { companyId } = await authorize(request.auth, 'company:settings:write');
      await Promise.all([
        db.collection(connectionCollection).doc(companyId).delete(),
        db.doc(`companies/${companyId}/settings/main`).set({ googleDriveConnected: false, googleDriveFolderId: FieldValue.delete(), googleDriveConnectedAt: FieldValue.delete() }, { merge: true }),
      ]);
      return { success: true };
    }),

    uploadOrderDesignImage: onCall({ ...options, timeoutSeconds: 120, memory: '512MiB' }, async (request: Request) => {
      const { companyId } = await authorize(request.auth, 'company:orders:write');
      const input = (request.data || {}) as { name?: unknown; mimeType?: unknown; base64?: unknown };
      const name = fileName(input.name);
      const mimeType = imageMimeType(input.mimeType);
      if (typeof input.base64 !== 'string' || input.base64.length === 0 || input.base64.length > 8_000_000 || !/^[A-Za-z0-9+/=]+$/.test(input.base64)) throw new HttpsError('invalid-argument', 'الصورة غير صالحة أو حجمها أكبر من 6 ميجابايت.');
      const image = Buffer.from(input.base64, 'base64');
      if (!image.length || image.length > 6 * 1024 * 1024) throw new HttpsError('invalid-argument', 'حجم الصورة يجب ألا يزيد عن 6 ميجابايت.');
      const { accessToken, folderId } = await refreshAccessToken(companyId);
      const boundary = `drive_upload_${crypto.randomBytes(12).toString('hex')}`;
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folderId] })}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
        image,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const driveResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
      const driveFile = await driveResponse.json() as { id?: string; name?: string; webViewLink?: string };
      if (!driveResponse.ok || !driveFile.id || !driveFile.webViewLink) throw new HttpsError('internal', 'تعذر رفع الصورة إلى Google Drive.');
      await db.collection(connectionCollection).doc(companyId).collection(uploadedFileCollection).doc(driveFile.id).set({
        folderId,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { id: driveFile.id, name: driveFile.name || name, url: driveFile.webViewLink };
    }),

    deleteOrderDesignImage: onCall(options, async (request: Request) => {
      const { companyId } = await authorize(request.auth, 'company:orders:write');
      const fileId = driveFileId((request.data as { fileId?: unknown })?.fileId);
      const { accessToken, folderId } = await refreshAccessToken(companyId);
      const fileRef = db.collection(connectionCollection).doc(companyId).collection(uploadedFileCollection).doc(fileId);
      const trackedFile = await fileRef.get();
      if (!trackedFile.exists || trackedFile.data()?.folderId !== folderId) {
        // Files uploaded before the tracking collection was introduced are
        // still safe to delete when Drive confirms that they belong to this
        // company's connected folder.  Never trust the file ID alone.
        const metadataResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,parents`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const metadata = await metadataResponse.json() as { id?: string; parents?: string[] };
        if (!metadataResponse.ok || !metadata.id || !Array.isArray(metadata.parents) || !metadata.parents.includes(folderId)) {
          throw new HttpsError('permission-denied', 'لا يمكن حذف هذه الصورة لأنها ليست داخل فولدر Google Drive الخاص بالشركة.');
        }
      }
      const driveResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      });
      const driveFile = await driveResponse.json() as { id?: string; trashed?: boolean };
      if (!driveResponse.ok || !driveFile.id || !driveFile.trashed) {
        throw new HttpsError('internal', 'تعذر حذف الصورة من Google Drive.');
      }
      await fileRef.delete();
      return { success: true };
    }),
  };
};

const loggerError = (error: unknown) => console.error('Google Drive connection error', error instanceof Error ? error.message : error);
