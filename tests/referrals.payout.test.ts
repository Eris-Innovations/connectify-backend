import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  milestone: 3,
  verifiedByInviter: new Map<string, number>(),
  payouts: [] as { userId: string; status: 'paid'; paidAt: Date; paidByAdminId: string }[],
  users: [{ _id: 'user-1', name: 'Ayesha', email: 'ayesha@example.com', phone: '+923001111111' }],
}));

vi.mock('../src/modules/users/user.model', () => ({
  UserModel: {
    find: (query: { _id?: { $in: string[] } }) => ({
      select: () => ({
        lean: async () => {
          const ids = query._id?.$in ?? [];
          return db.users.filter((user) => ids.includes(user._id));
        },
      }),
    }),
  },
}));

vi.mock('../src/modules/referrals/referral.models', () => ({
  getReferralSettings: async () => ({ milestone: db.milestone, rewardAmountPkr: 100 }),
  ReferralInviteModel: {
    countDocuments: async (query: { inviterId: string; status: string }) =>
      query.status === 'verified' ? db.verifiedByInviter.get(query.inviterId) ?? 0 : 0,
    find: (query: { status?: string; inviterId?: string }) => {
      if (query.status === 'verified' && !query.inviterId) {
        const rows = [...db.verifiedByInviter.entries()].flatMap(([inviterId, count]) =>
          Array.from({ length: count }, () => ({ inviterId }))
        );
        return { select: () => ({ lean: async () => rows }) };
      }
      return {
        sort: () => ({ lean: async () => [] }),
        select: () => ({ lean: async () => [] }),
      };
    },
  },
  ReferralPayoutModel: {
    findOne: (query: { userId: string; status: string }) => ({
      lean: async () =>
        db.payouts.find((payout) => payout.userId === query.userId && payout.status === query.status) ?? null,
    }),
    find: (query: { status: string }) => ({
      sort: () => ({
        lean: async () => db.payouts.filter((payout) => payout.status === query.status),
      }),
      select: () => ({
        lean: async () => db.payouts.filter((payout) => payout.status === query.status),
      }),
    }),
    create: async (doc: { userId: string; paidByAdminId: string }) => {
      db.payouts.push({ ...doc, status: 'paid', paidAt: new Date() });
    },
  },
}));

vi.mock('../src/lib/email', () => ({
  sendReferralInviteEmail: async () => ({ sent: false, reason: 'not_configured' }),
}));

import { ReferralError, getMyReferrals, listPayouts, markPayoutPaid } from '../src/modules/referrals/referral.service';

describe('referral payouts', () => {
  beforeEach(() => {
    db.milestone = 3;
    db.verifiedByInviter = new Map([['user-1', 2]]);
    db.payouts = [];
    db.users = [{ _id: 'user-1', name: 'Ayesha', email: 'ayesha@example.com', phone: '+923001111111' }];
  });

  it('stays locked below the milestone', async () => {
    const mine = await getMyReferrals('user-1');
    expect(mine.rewardStatus).toBe('locked');
  });

  it('lists a user as ready at the milestone and paid after marking', async () => {
    db.verifiedByInviter.set('user-1', 3);
    expect((await listPayouts('ready')).map((row) => row.userId)).toContain('user-1');
    await markPayoutPaid('user-1', 'admin-1');
    expect((await listPayouts('ready')).map((row) => row.userId)).not.toContain('user-1');
    expect((await listPayouts('paid')).map((row) => row.userId)).toContain('user-1');
    await expect(markPayoutPaid('user-1', 'admin-1')).rejects.toThrow('Already paid.');
  });

  it('rejects payment before the milestone', async () => {
    await expect(markPayoutPaid('user-1', 'admin-1')).rejects.toBeInstanceOf(ReferralError);
  });

  it('hides an unpaid user when the milestone rises and keeps a paid user paid', async () => {
    db.verifiedByInviter.set('user-1', 3);
    await markPayoutPaid('user-1', 'admin-1');
    db.milestone = 5;
    db.verifiedByInviter.set('user-2', 3);
    db.users.push({ _id: 'user-2', name: 'Bilal', email: 'bilal@example.com', phone: '+923002222222' });
    expect((await listPayouts('ready')).map((row) => row.userId)).not.toContain('user-2');
    expect((await listPayouts('paid')).map((row) => row.userId)).toContain('user-1');
  });
});
