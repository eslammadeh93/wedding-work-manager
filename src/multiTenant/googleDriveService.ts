import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';

type DriveCallableError = Error & { code?: string };

const errorMessage = (error: unknown, fallback: string) => {
  const code = String((error as DriveCallableError)?.code || '');
  if (code.includes('permission-denied')) return 'ليس لديك صلاحية لتنفيذ هذه العملية.';
  if (code.includes('unauthenticated')) return 'انتهت جلسة تسجيل الدخول. سجّل الدخول مرة أخرى.';
  if (code.includes('failed-precondition')) return (error as Error)?.message || 'أكمل ربط Google Drive من الإعدادات أولًا.';
  return (error as Error)?.message || fallback;
};

const invoke = async <Request, Response>(name: string, data: Request, fallback: string) => {
  try {
    return (await httpsCallable<Request, Response>(functions, name)(data)).data;
  } catch (error) {
    throw new Error(errorMessage(error, fallback));
  }
};

export const googleDriveService = {
  beginConnection: (folderUrl: string) => invoke<{ folderUrl: string }, { authorizationUrl: string }>('beginGoogleDriveConnection', { folderUrl }, 'تعذر بدء ربط Google Drive.'),
  connectionStatus: () => invoke<Record<string, never>, { connected: boolean }>('getGoogleDriveConnectionStatus', {}, 'تعذر التحقق من حالة Google Drive.'),
  disconnect: () => invoke<Record<string, never>, { success: boolean }>('disconnectGoogleDrive', {}, 'تعذر إلغاء ربط Google Drive.'),
  uploadImage: (input: { name: string; mimeType: string; base64: string }) => invoke<typeof input, { id: string; name: string; url: string }>('uploadOrderDesignImage', input, 'تعذر رفع الصورة إلى Google Drive.'),
  deleteImage: (fileId: string) => invoke<{ fileId: string }, { success: boolean }>('deleteOrderDesignImage', { fileId }, 'تعذر حذف الصورة من Google Drive.'),
};

export const fileToBase64 = async (file: File) => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('تعذر قراءة الصورة.'));
    reader.readAsDataURL(file);
  });
  const base64 = dataUrl.split(',', 2)[1] || '';
  if (!base64) throw new Error('تعذر قراءة الصورة.');
  return base64;
};
