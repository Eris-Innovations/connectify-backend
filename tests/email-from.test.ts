import { describe, expect, it } from 'vitest';
import { normalizeEmailFrom } from '../src/lib/email';

describe('normalizeEmailFrom', () => {
  it('wraps a bare address', () => {
    expect(normalizeEmailFrom('Connectify@eris-innovations.com')).toBe(
      'Connectify <Connectify@eris-innovations.com>'
    );
  });

  it('keeps Name <email> form', () => {
    expect(normalizeEmailFrom('Connectify <noreply@eris-innovations.com>')).toBe(
      'Connectify <noreply@eris-innovations.com>'
    );
  });

  it('trims whitespace', () => {
    expect(normalizeEmailFrom('  a@b.com  ')).toBe('Connectify <a@b.com>');
  });
});
