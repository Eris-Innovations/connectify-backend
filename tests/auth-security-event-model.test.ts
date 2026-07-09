import { describe, expect, it } from 'vitest';
import { AuthSecurityEventModel } from '../src/modules/auth/security-event.model';

describe('auth security event model', () => {
  it('stores minimal login metadata for abuse and account-security review', () => {
    const event = new AuthSecurityEventModel({
      email: 'USER@Example.com',
      event: 'login_success',
      ipAddress: '203.0.113.10',
      userAgent: 'Connectify Test',
      platform: 'android',
      appVersion: '1.0.3',
    });

    expect(event.validateSync()).toBeUndefined();
    expect(event.email).toBe('user@example.com');
    expect(event.ipAddress).toBe('203.0.113.10');
    expect(event.platform).toBe('android');
  });
});
