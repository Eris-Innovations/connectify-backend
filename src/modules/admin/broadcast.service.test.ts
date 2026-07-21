import { describe, expect, it } from 'vitest';
import { buildBroadcastRecipientQuery, normalizeBroadcastTargetGroup } from './broadcast.service';

describe('broadcast recipient selection', () => {
  it('defaults to all regular users', () => {
    expect(buildBroadcastRecipientQuery('all', [])).toEqual({ role: 'user' });
  });

  it('supports custom target with specific ids', () => {
    const query = buildBroadcastRecipientQuery('custom', ['507f1f77bcf86cd799439011']);
    expect(query).toMatchObject({ role: 'user' });
    expect(query._id).toBeDefined();
  });

  it('supports verified users target', () => {
    const query = buildBroadcastRecipientQuery('verified', []);
    expect(query).toMatchObject({ role: 'user', isVerified: true });
  });

  it('normalizes target group input safely', () => {
    expect(normalizeBroadcastTargetGroup('verified')).toBe('verified');
    expect(normalizeBroadcastTargetGroup('unknown' as never)).toBe('all');
  });
});
