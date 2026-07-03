import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Normalize a valid international number to E.164. Returns null if invalid. */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('+')) return null;
  const parsed = parsePhoneNumberFromString(trimmed);
  if (!parsed?.isValid()) return null;
  return parsed.number;
}

export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Build distinct digit patterns for flexible phone lookup (country code, leading 0, suffix). */
export function phoneSearchPatterns(qInput: string): string[] {
  const raw = qInput.trim();
  if (!raw) return [];

  const patterns = new Set<string>();
  const digits = phoneDigits(raw);

  if (digits.length >= 4) patterns.add(digits);
  if (digits.startsWith('0') && digits.length > 4) patterns.add(digits.slice(1));
  if (digits.length >= 7) patterns.add(digits.slice(-10));
  if (digits.length >= 6) patterns.add(digits.slice(-9));

  const normalized = normalizePhone(raw);
  if (normalized) {
    patterns.add(normalized);
    const nd = phoneDigits(normalized);
    patterns.add(nd);
    if (nd.length > 10) patterns.add(nd.slice(-10));
  }

  return [...patterns].filter((p) => p.length >= 4);
}
