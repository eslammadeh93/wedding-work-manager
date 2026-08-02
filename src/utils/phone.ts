/** Removes spaces (including pasted tabs/newlines and non-breaking spaces) from phone input. */
export const sanitizePhoneInput = (value: string) => value.replace(/\s+/g, '');
