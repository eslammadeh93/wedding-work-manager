/** Removes spaces (including pasted tabs/newlines and non-breaking spaces) from phone input. */
export const sanitizePhoneInput = (value: string) => value.replace(/\s+/g, '');

const normalizeDigits = (value: string) => {
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  const easternArabicIndic = '۰۱۲۳۴۵۶۷۸۹';
  return value
    .replace(/[٠-٩]/g, digit => String(arabicIndic.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String(easternArabicIndic.indexOf(digit)));
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
