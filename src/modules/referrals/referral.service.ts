import crypto from 'crypto';
import { StatusCodes } from 'http-status-codes';
import { Types } from 'mongoose';
import { sendReferralInviteEmail } from '../../lib/email';
import { UserModel } from '../users/user.model';
import {
  ReferralInviteModel,
  ReferralPayoutModel,
  getReferralSettings
} from './referral.models';

export class ReferralError extends Error {
  constructor(
    message: string,
    readonly status: number = StatusCodes.BAD_REQUEST
  ) {
    super(message);
  }
}

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function createReferralInvite(inviterId: string, rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ReferralError('Enter a valid email address.');
  }

  const inviter = await UserModel.findById(inviterId).select('email').lean();
  if (!inviter) throw new ReferralError('User not found', StatusCodes.NOT_FOUND);
  if (inviter.email === email) throw new ReferralError('You cannot invite your own email.');

  const existingUser = await UserModel.findOne({ email }).select('_id').lean();
  if (existingUser) throw new ReferralError('This email already has an account.');

  const existingInvite = await ReferralInviteModel.findOne({ email }).select('_id').lean();
  if (existingInvite) throw new ReferralError('This email has already been invited.');

  const code = crypto.randomBytes(3).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await ReferralInviteModel.create({
    inviterId,
    email,
    code,
    status: 'pending',
    expiresAt
  });
  await sendReferralInviteEmail(email, code);
  return { email, code, expiresAt };
}

export async function verifyReferralOnOtp(userId: string) {
  const user = await UserModel.findById(userId).select('email pendingInviteCode').lean();
  const code = user?.pendingInviteCode?.trim().toLowerCase();
  if (!user || !code) return;

  const invite = await ReferralInviteModel.findOne({
    email: user.email,
    code,
    status: 'pending'
  });

  if (invite && invite.expiresAt.getTime() > Date.now()) {
    invite.status = 'verified';
    invite.inviteeId = new Types.ObjectId(userId);
    invite.verifiedAt = new Date();
    await invite.save();
  }

  await UserModel.updateOne({ _id: userId }, { $unset: { pendingInviteCode: 1 } });
}

export async function getMyReferrals(userId: string) {
  const settings = await getReferralSettings();
  const [verifiedCount, invites, payout] = await Promise.all([
    ReferralInviteModel.countDocuments({ inviterId: userId, status: 'verified' }),
    ReferralInviteModel.find({ inviterId: userId }).sort({ createdAt: -1 }).lean(),
    ReferralPayoutModel.findOne({ userId, status: 'paid' }).lean()
  ]);

  let rewardStatus: 'locked' | 'ready' | 'paid' = 'locked';
  if (payout) rewardStatus = 'paid';
  else if (verifiedCount >= settings.milestone) rewardStatus = 'ready';

  return {
    milestone: settings.milestone,
    rewardAmountPkr: 100 as const,
    verifiedCount,
    rewardStatus,
    invites: invites.map((invite) => ({
      email: invite.email,
      status: invite.status,
      expiresAt: invite.expiresAt,
      verifiedAt: invite.verifiedAt ?? null
    }))
  };
}

async function verifiedCounts() {
  const rows = await ReferralInviteModel.find({ status: 'verified' }).select('inviterId').lean();
  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = String(row.inviterId);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export async function listPayouts(status: 'ready' | 'paid') {
  const settings = await getReferralSettings();
  const counts = await verifiedCounts();

  if (status === 'paid') {
    const payouts = await ReferralPayoutModel.find({ status: 'paid' }).sort({ paidAt: -1 }).lean();
    const users = await UserModel.find({ _id: { $in: payouts.map((payout) => payout.userId) } })
      .select('name email phone')
      .lean();
    const byId = new Map(users.map((user) => [String(user._id), user]));
    return payouts.map((payout) => {
      const user = byId.get(String(payout.userId));
      return {
        userId: String(payout.userId),
        name: user?.name ?? '',
        email: user?.email ?? '',
        phone: user?.phone ?? '',
        verifiedCount: counts.get(String(payout.userId)) ?? 0,
        paidAt: payout.paidAt,
        paidByAdminId: String(payout.paidByAdminId)
      };
    });
  }

  const paid = await ReferralPayoutModel.find({ status: 'paid' }).select('userId').lean();
  const paidIds = new Set(paid.map((payout) => String(payout.userId)));
  const readyIds = [...counts.entries()]
    .filter(([id, count]) => count >= settings.milestone && !paidIds.has(id))
    .map(([id]) => id);
  const users = await UserModel.find({ _id: { $in: readyIds } }).select('name email phone').lean();
  return users.map((user) => ({
    userId: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone ?? '',
    verifiedCount: counts.get(String(user._id)) ?? 0
  }));
}

export async function markPayoutPaid(userId: string, adminId: string) {
  const settings = await getReferralSettings();
  const verifiedCount = await ReferralInviteModel.countDocuments({ inviterId: userId, status: 'verified' });
  if (verifiedCount < settings.milestone) {
    throw new ReferralError('This user has not reached the invite milestone.');
  }
  const existing = await ReferralPayoutModel.findOne({ userId, status: 'paid' }).lean();
  if (existing) throw new ReferralError('Already paid.');

  await ReferralPayoutModel.create({
    userId,
    status: 'paid',
    paidAt: new Date(),
    paidByAdminId: adminId
  });
}
