/**
 * React already escapes rendered text. This extra normalization prevents
 * markup and script-like payloads from being persisted or later used as data.
 */
const UNSAFE_TEXT = /<\/?\s*[a-z!][^>]*>|javascript\s*:|data\s*:\s*text\/html|on[a-z]+\s*=/gi;

export const sanitizeText = (value: string): string =>
  value.replace(/\u0000/g, '').replace(UNSAFE_TEXT, '').trimStart();

export const sanitizeData = <T>(value: T): T => {
  if (typeof value === 'string') return sanitizeText(value) as T;
  if (Array.isArray(value)) return value.map(sanitizeData) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeData(item)])
    ) as T;
  }
  return value;
};

/** Reject script/data schemes before opening user-provided links. */
export const toSafeExternalUrl = (value: string): string | null => {
  const trimmed = sanitizeText(value).trim();
  if (!trimmed) return null;
  const url = trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
};
