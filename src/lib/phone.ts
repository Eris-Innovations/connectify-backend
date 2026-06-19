/** Normalize to E.164-style `+<digits>` (8–15 digits). Returns null if invalid. */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
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
