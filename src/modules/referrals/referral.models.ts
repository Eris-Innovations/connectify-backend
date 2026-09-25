import { Schema, model } from 'mongoose';

const referralInviteSchema = new Schema(
  {
    inviterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    code: { type: String, required: true },
    status: { type: String, enum: ['pending', 'verified', 'expired'], default: 'pending', index: true },
    inviteeId: { type: Schema.Types.ObjectId, ref: 'User' },
    expiresAt: { type: Date, required: true },
    verifiedAt: { type: Date }
  },
  { timestamps: true }
);

const referralSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    milestone: { type: Number, required: true, default: 3 },
    rewardAmountPkr: { type: Number, required: true, default: 100 }
  },
  { timestamps: true }
);

const referralPayoutSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    status: { type: String, enum: ['paid'], required: true, default: 'paid' },
    paidAt: { type: Date, required: true },
    paidByAdminId: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

export const ReferralInviteModel = model('ReferralInvite', referralInviteSchema);
export const ReferralSettingsModel = model('ReferralSettings', referralSettingsSchema);
export const ReferralPayoutModel = model('ReferralPayout', referralPayoutSchema);

export async function getReferralSettings() {
  const doc = await ReferralSettingsModel.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { key: 'default', milestone: 3, rewardAmountPkr: 100 } },
    { upsert: true, new: true }
  ).lean();
  return { milestone: doc?.milestone ?? 3, rewardAmountPkr: 100 as const };
}

export async function setReferralMilestone(milestone: number) {
  if (!Number.isInteger(milestone) || milestone < 1 || milestone > 100) {
    throw new Error('Milestone must be an integer from 1 to 100.');
  }
  await ReferralSettingsModel.findOneAndUpdate(
    { key: 'default' },
    { $set: { milestone, rewardAmountPkr: 100 }, $setOnInsert: { key: 'default' } },
    { upsert: true, new: true }
  );
  return getReferralSettings();
}
