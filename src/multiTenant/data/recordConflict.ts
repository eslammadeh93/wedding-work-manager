import type { DataErrorCode } from './companyDataService';

/** Signals a failed optimistic-concurrency check on a version-checked write. */
export class RecordConflictError extends Error {
  constructor(readonly code: DataErrorCode, message: string) {
    super(message);
    this.name = 'RecordConflictError';
  }
}
