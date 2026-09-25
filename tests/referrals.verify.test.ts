import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { email: 'friend@example.com', pendingInviteCode: 'abc123' } as {
    email: string;
    pendingInviteCode?: string;
  } | null,
  invite: null as null | {
    email: string;
    code: string;
    status: string;
    expiresAt: Date;
    inviteeId?: unknown;
    verifiedAt?: Date;
    save: () => Promise<void>;
  },
  cleared: false,
}));

vi.mock('../src/modules/users/user.model', () => ({
  UserModel: {
    findById: () => ({
      select: () => ({ lean: async () => state.user }),
    }),
    updateOne: async () => {
      state.cleared = true;
    },
  },
}));

vi.mock('../src/modules/referrals/referral.models', () => ({
  ReferralInviteModel: {
    findOne: async (query: { email: string; code: string; status: string }) => {
      if (!state.invite) return null;
      if (
        state.invite.email === query.email &&
        state.invite.code === query.code &&
        state.invite.status === query.status
      ) {
        return state.invite;
      }
      return null;
    },
  },
  ReferralPayoutModel: {},
  getReferralSettings: async () => ({ milestone: 3, rewardAmountPkr: 100 }),
}));

vi.mock('../src/lib/email', () => ({
  sendReferralInviteEmail: async () => ({ sent: false, reason: 'not_configured' }),
}));

import { verifyReferralOnOtp } from '../src/modules/referrals/referral.service';

function pendingInvite(overrides: Partial<NonNullable<typeof state.invite>> = {}) {
  const invite = {
    email: 'friend@example.com',
    code: 'abc123',
    status: 'pending',
    expiresAt: new Date(Date.now() + 60_000),
    save: async () => undefined,
    ...overrides,
  };
  invite.save = async () => undefined;
  return invite;
}

describe('verifyReferralOnOtp', () => {
  beforeEach(() => {
    state.user = { email: 'friend@example.com', pendingInviteCode: 'abc123' };
    state.invite = pendingInvite();
    state.cleared = false;
  });

  it('verifies a matching pending invite', async () => {
    await verifyReferralOnOtp('507f1f77bcf86cd799439011');
    expect(state.invite?.status).toBe('verified');
    expect(state.invite?.verifiedAt).toBeInstanceOf(Date);
    expect(state.cleared).toBe(true);
  });

  it('leaves the invite pending when the code does not match', async () => {
    state.user = { email: 'friend@example.com', pendingInviteCode: 'ffffff' };
    await verifyReferralOnOtp('507f1f77bcf86cd799439011');
    expect(state.invite?.status).toBe('pending');
  });

  it('does not count an expired invite', async () => {
    state.invite = pendingInvite({ expiresAt: new Date(Date.now() - 1000) });
    await verifyReferralOnOtp('507f1f77bcf86cd799439011');
    expect(state.invite?.status).toBe('pending');
  });

  it('does not count a code used with a different email', async () => {
    state.user = { email: 'other@example.com', pendingInviteCode: 'abc123' };
    await verifyReferralOnOtp('507f1f77bcf86cd799439011');
    expect(state.invite?.status).toBe('pending');
  });

  it('does not verify the same invite twice', async () => {
    await verifyReferralOnOtp('507f1f77bcf86cd799439011');
    const verifiedAt = state.invite?.verifiedAt;
    await verifyReferralOnOtp('507f1f77bcf86cd799439011');
    expect(state.invite?.verifiedAt).toBe(verifiedAt);
  });
});
