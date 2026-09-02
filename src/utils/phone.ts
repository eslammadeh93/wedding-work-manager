const normalizeDigits = (value: string) => value
  .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[\u06F0-\u06F9]/g, digit => String(digit.charCodeAt(0) - 0x06F0));

/**
 * Converts pasted phone numbers to a stable form for storage and RTL display.
 * Separators such as spaces, parentheses, and all dash variants are removed;
 * an international `+` is retained only when it starts the number.
 */
export const sanitizePhoneInput = (value: string) => {
  const normalized = normalizeDigits(value.trim());
  const digits = normalized.replace(/\D/g, '');
  return digits ? `${normalized.startsWith('+') ? '+' : ''}${digits}` : '';
};

/** Returns digits in international form for wa.me. Local numbers default to Egypt (+20). */
export const toInternationalPhoneDigits = (value: string, countryCallingCode = '20') => {
  const normalized = normalizeDigits(value.trim());
  const digits = normalized.replace(/\D/g, '');
  if (!digits) return '';
  if (normalized.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return `${countryCallingCode}${digits.slice(1)}`;
  if (countryCallingCode === '20' && digits.length === 10 && digits.startsWith('1')) return `20${digits}`;
  return digits;
};

export const toTelHref = (value: string) => {
  const digits = toInternationalPhoneDigits(value);
  return digits ? `tel:+${digits}` : '';
};

export const toWhatsAppHref = (value: string) => {
  const digits = toInternationalPhoneDigits(value);
  return digits ? `https://wa.me/${digits}` : '';
};
