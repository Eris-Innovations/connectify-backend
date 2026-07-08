import { Types } from 'mongoose';
import { UserModel } from '../users/user.model';
import { BroadcastAnnouncementModel, type BroadcastAnnouncementDocument } from './broadcast.model';
import { getExpoPushTokensForUser, sendExpoPush } from '../../lib/expoPush';
import { emitToUser } from '../../sockets/io';

export type BroadcastTargetGroup = 'all' | 'verified' | 'creators' | 'custom';

export function normalizeBroadcastTargetGroup(value: string | undefined): BroadcastTargetGroup {
  return value === 'verified' || value === 'creators' || value === 'custom' ? value : 'all';
}

export function buildBroadcastRecipientQuery(targetGroup: BroadcastTargetGroup, targetUserIds: string[]) {
  const normalizedIds = targetUserIds.filter((id) => Types.ObjectId.isValid(id));
  if (targetGroup === 'custom' && normalizedIds.length > 0) {
    return { role: 'user', _id: { $in: normalizedIds.map((id) => new Types.ObjectId(id)) } };
  }
  if (targetGroup === 'verified') {
    return { role: 'user', isVerified: true };
  }
  if (targetGroup === 'creators') {
    return { role: 'user', 'creatorProfile.isCreator': true };
  }
  return { role: 'user' };
}

export async function createBroadcastAnnouncement(input: {
  createdByUserId: string;
  title: string;
  body: string;
  targetGroup: BroadcastTargetGroup;
  targetUserIds?: string[];
}) {
  const doc = await BroadcastAnnouncementModel.create({
    createdByUserId: new Types.ObjectId(input.createdByUserId),
    title: input.title.trim(),
    body: input.body.trim(),
    targetGroup: input.targetGroup,
    targetUserIds: (input.targetUserIds ?? []).filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id)),
    status: 'sending'
  });

  void dispatchBroadcastAnnouncement(String(doc._id));
  return doc;
}

export async function dispatchBroadcastAnnouncement(announcementId: string): Promise<void> {
  const announcement = await BroadcastAnnouncementModel.findById(announcementId).lean<BroadcastAnnouncementDocument | null>();
  if (!announcement) return;

  const targetUserIds = (announcement.targetUserIds ?? []).map((id) => String(id));
  const recipients = await UserModel.find(buildBroadcastRecipientQuery(announcement.targetGroup as BroadcastTargetGroup, targetUserIds))
    .select('_id settings expoPushTokens')
    .lean();

  const userIds = recipients.map((user) => String(user._id));

  await BroadcastAnnouncementModel.findByIdAndUpdate(announcementId, {
    audienceCount: userIds.length,
    status: userIds.length > 0 ? 'sending' : 'sent'
  });

  if (userIds.length === 0) return;

  const queue = userIds.map(async (userId) => {
    const tokens = await getExpoPushTokensForUser(userId, { category: 'general' });
    if (tokens.length > 0) {
      await sendExpoPush(tokens.map((token) => ({
        to: token,
        title: announcement.title,
        body: announcement.body,
        data: { type: 'announcement', announcementId },
        sound: 'default',
        priority: 'high'
      })));
    }

    emitToUser(userId, 'announcement', {
      id: announcementId,
      title: announcement.title,
      body: announcement.body,
      createdAt: new Date().toISOString(),
      type: 'announcement'
    });

    await BroadcastAnnouncementModel.findByIdAndUpdate(announcementId, {
      $inc: { deliveredCount: 1 }
    });
  });

  await Promise.allSettled(queue);

  await BroadcastAnnouncementModel.findByIdAndUpdate(announcementId, {
    status: 'sent'
  });
}
