/**
 * Normalises a phone number to E.164 (+8801712345678). Bangladeshi local forms
 * ("01712345678", "8801712345678") are accepted. Returns null if it does not
 * look like a phone number, so callers can reject it instead of storing junk.
 */
function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  let s = input.replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (/^01\d{9}$/.test(s)) s = `+88${s}`;
  else if (/^8801\d{9}$/.test(s)) s = `+${s}`;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

module.exports = { normalizePhone };
