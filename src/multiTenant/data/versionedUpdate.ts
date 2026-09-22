import { RecordConflictError } from './recordConflict';

/**
 * Optimistic-concurrency write shared by the records an editor can hold open
 * for minutes at a time.
 *
 * Two properties matter for financial records: the document must still exist
 * (a transaction `update` on a missing document fails, so a stale editor can
 * never recreate a deleted expense), and its stored version must still be the
 * one the editor started from.
 */
export interface VersionedSnapshot {
  exists(): boolean;
  data(): Record<string, unknown> | undefined;
}

export interface VersionedTransaction<Ref> {
  get(reference: Ref): Promise<VersionedSnapshot>;
  update(reference: Ref, value: object): unknown;
}

export const applyVersionedUpdate = async <Ref>(
  transaction: VersionedTransaction<Ref>,
  reference: Ref,
  value: object,
  expectedUpdatedAt?: string,
): Promise<void> => {
  const snapshot = await transaction.get(reference);
  const current = snapshot.exists() ? snapshot.data() || {} : undefined;
  if (!current || current.deletedAt) {
    throw new RecordConflictError('NOT_FOUND', 'تم حذف هذا السجل. حدّث الصفحة قبل الحفظ.');
  }
  const currentVersion = typeof current.updatedAt === 'string' ? current.updatedAt : undefined;
  // Records saved before `updatedAt` existed carry no version to compare.
  if (expectedUpdatedAt && currentVersion && expectedUpdatedAt !== currentVersion) {
    throw new RecordConflictError('CONFLICT', 'تم تعديل هذا السجل من مستخدم آخر. حدّث الصفحة ثم حاول مرة أخرى.');
  }
  transaction.update(reference, value);
};
