import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inviter: { email: 'owner@connectify.test' } as { email: string } | null,
  existingUser: null as { _id: string } | null,
  existingInvite: null as { _id: string } | null,
  created: null as Record<string, unknown> | null,
}));

vi.mock('../src/modules/users/user.model', () => ({
  UserModel: {
    findById: () => ({
      select: () => ({ lean: async () => mocks.inviter }),
    }),
    findOne: () => ({
      select: () => ({ lean: async () => mocks.existingUser }),
    }),
  },
}));

vi.mock('../src/modules/referrals/referral.models', () => ({
  ReferralInviteModel: {
    findOne: () => ({
      select: () => ({ lean: async () => mocks.existingInvite }),
    }),
    create: async (doc: Record<string, unknown>) => {
      mocks.created = doc;
      return doc;
    },
  },
  ReferralPayoutModel: {},
  getReferralSettings: async () => ({ milestone: 3, rewardAmountPkr: 100 }),
}));

vi.mock('../src/lib/email', () => ({
  sendReferralInviteEmail: async () => ({ sent: false, reason: 'not_configured' }),
}));

import { ReferralError, createReferralInvite } from '../src/modules/referrals/referral.service';

describe('createReferralInvite', () => {
  beforeEach(() => {
    mocks.inviter = { email: 'owner@connectify.test' };
    mocks.existingUser = null;
    mocks.existingInvite = null;
    mocks.created = null;
  });

  it('creates a pending invite with a 6 character code', async () => {
    const result = await createReferralInvite('owner-1', ' Friend@Example.com ');
    expect(result.email).toBe('friend@example.com');
    expect(result.code).toMatch(/^[a-f0-9]{6}$/);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + 13 * 24 * 60 * 60 * 1000);
    expect(mocks.created).toMatchObject({ email: 'friend@example.com', status: 'pending' });
  });

  it('rejects an email that already has an account', async () => {
    mocks.existingUser = { _id: 'user-2' };
    await expect(createReferralInvite('owner-1', 'friend@example.com')).rejects.toThrow(
      'This email already has an account.'
    );
  });

  it('rejects an email that was already invited', async () => {
    mocks.existingInvite = { _id: 'invite-1' };
    await expect(createReferralInvite('owner-1', 'friend@example.com')).rejects.toThrow(
      'This email has already been invited.'
    );
  });

  it('rejects the inviter email', async () => {
    await expect(createReferralInvite('owner-1', 'owner@connectify.test')).rejects.toBeInstanceOf(ReferralError);
    await expect(createReferralInvite('owner-1', 'owner@connectify.test')).rejects.toThrow(
      'You cannot invite your own email.'
    );
  });
});
