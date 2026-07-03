import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../src/lib/phone';

describe('phone normalization', () => {
  it('normalizes valid international numbers to E.164', () => {
    expect(normalizePhone('+92 300 1234567')).toBe('+923001234567');
  });

  it('rejects national-only, impossible, and oversized values', () => {
    expect(normalizePhone('03001234567')).toBeNull();
    expect(normalizePhone('+920000000000')).toBeNull();
    expect(normalizePhone('+12345678901234567890')).toBeNull();
  });
});
