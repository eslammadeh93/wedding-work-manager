/**
 * Durable identity for a create.
 *
 * A financial record must not be created twice because a save was retried, a
 * form remounted, or a request timed out and the user pressed save again.
 * Disabling the button only covers the first of those: the network cases all
 * end with the caller genuinely not knowing whether the write landed.
 *
 * So the *document id* carries the identity. One id is generated when the form
 * opens, reused for every retry of that same submission, and used directly as
 * the Firestore document id. A repeat write therefore targets the document
 * that already exists, and the create transaction - which already refuses to
 * overwrite an existing order - turns the duplicate into a no-op instead of a
 * second record. A genuinely new submission gets a new id.
 *
 * This needs no extra collection, no reservation document and no cleanup.
 */
const randomToken = (): string => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replace(/-/g, '').slice(0, 20);
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
};

/** A fresh submission id for one create attempt, prefixed like the ids it replaces. */
export const newSubmissionId = (prefix: string): string => `${prefix}_${randomToken()}`;

/**
 * The id to use for this submission: the one already held, or a new one.
 * Callers keep the result for the lifetime of the form so retries reuse it.
 */
export const submissionIdFor = (prefix: string, existing: string | null | undefined): string =>
  existing && existing.startsWith(`${prefix}_`) ? existing : newSubmissionId(prefix);

/** True when two create attempts are the same submission rather than two records. */
export const isSameSubmission = (a: string | null | undefined, b: string | null | undefined): boolean =>
  Boolean(a) && a === b;
