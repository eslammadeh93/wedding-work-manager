import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';
import type { RecycleBinItem } from '../types';

type PermanentDeleteResponse = { success: boolean; code: string; message: string };

export const recycleBinService = {
  permanentlyDelete: async (item: RecycleBinItem): Promise<PermanentDeleteResponse> => {
    try {
      return (await httpsCallable<{ type: RecycleBinItem['type']; id: string }, PermanentDeleteResponse>(functions, 'permanentlyDeleteRecycleBinItem')({ type: item.type, id: item.id })).data;
    } catch (error) {
      const code = String((error as { code?: unknown })?.code || 'functions/unknown');
      if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) console.error('[recycle-bin]', { action: 'permanent-delete', code, error });
      return { success: false, code, message: 'تعذر تنفيذ الحذف النهائي. حاول مرة أخرى.' };
    }
  },
};
