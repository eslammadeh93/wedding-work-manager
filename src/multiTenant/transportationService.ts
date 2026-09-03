import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';

export interface TransportationRoute {
  distanceMeters: number;
  durationSeconds: number;
}

type CallableError = Error & { code?: string };

const messageFor = (error: unknown) => {
  const code = String((error as CallableError)?.code || '');
  const message = (error as Error)?.message?.trim();
  if (code.includes('unauthenticated')) return 'سجّل الدخول مرة أخرى ثم حاول الحساب.';
  if (code.includes('permission-denied')) return message || 'ليس لديك صلاحية استخدام حاسبة الانتقالات.';
  return message || 'تعذر حساب مسافة الانتقال الآن.';
};

export const transportationService = {
  async calculate(originUrl: string, destinationUrl: string): Promise<TransportationRoute> {
    try {
      return (await httpsCallable<{ originUrl: string; destinationUrl: string }, TransportationRoute>(
        functions,
        'calculateTransportationRoute',
      )({ originUrl, destinationUrl })).data;
    } catch (error) {
      throw new Error(messageFor(error));
    }
  },
};
