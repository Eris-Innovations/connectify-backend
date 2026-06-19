import { StatusCodes } from 'http-status-codes';
import { Types } from 'mongoose';
import { sortUserPair, ensureDmConversation, purgeDmBetweenUsers } from '../../lib/dmConversation';
import { resolveStoredMediaUrl } from '../../lib/r2';
import { UserModel } from '../users/user.model';
import { FriendConnectionModel } from './friend-connection.model';

export type FriendRelationship =
  | 'none'
  | 'friends'
  | 'pending_outgoing'
  | 'pending_incoming'
  | 'ignored';

type ServiceResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

async function formatUserSummary(userId: string) {
  const user = await UserModel.findById(userId).select('name username avatar phone').lean();
  if (!user) return null;
  const avatarUrl = user.avatar ? await resolveStoredMediaUrl(user.avatar) : '';
  return {
    id: String(user._id),
    name: user.name,
    username: user.username,
    phone: user.phone ?? '',
    avatarUrl
  };
}

export async function areFriends(userId: string, otherUserId: string): Promise<boolean> {
  const [userLow, userHigh] = sortUserPair(userId, otherUserId);
  const row = await FriendConnectionModel.findOne({ userLow, userHigh, status: 'accepted' }).lean();
  return Boolean(row);
}

export async function getFriendRelationship(
  userId: string,
  otherUserId: string
): Promise<{ status: FriendRelationship; connectionId?: string }> {
  if (userId === otherUserId) return { status: 'none' };
  const [userLow, userHigh] = sortUserPair(userId, otherUserId);
  const row = await FriendConnectionModel.findOne({ userLow, userHigh }).lean();
  if (!row) return { status: 'none' };
  if (row.status === 'accepted') return { status: 'friends', connectionId: String(row._id) };
  if (row.status === 'ignored') return { status: 'ignored', connectionId: String(row._id) };
  if (String(row.initiatedBy) === userId) {
    return { status: 'pending_outgoing', connectionId: String(row._id) };
  }
  return { status: 'pending_incoming', connectionId: String(row._id) };
}

export async function listFriendRequests(userId: string) {
  const rows = await FriendConnectionModel.find({
    status: 'pending',
    $or: [{ userLow: userId }, { userHigh: userId }]
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const incoming: Array<{
    id: string;
    user: NonNullable<Awaited<ReturnType<typeof formatUserSummary>>>;
    createdAt: Date;
  }> = [];
  const outgoing: typeof incoming = [];

  for (const row of rows) {
    const low = String(row.userLow);
    const high = String(row.userHigh);
    const initiatedBy = String(row.initiatedBy);
    const involvesMe = low === userId || high === userId;
    if (!involvesMe) continue;

    if (initiatedBy === userId) {
      const targetId = low === userId ? high : low;
      const user = await formatUserSummary(targetId);
      if (user) outgoing.push({ id: String(row._id), user, createdAt: row.createdAt });
    } else {
      const requesterId = initiatedBy;
      const user = await formatUserSummary(requesterId);
      if (user) incoming.push({ id: String(row._id), user, createdAt: row.createdAt });
    }
  }

  return { incoming, outgoing, incomingCount: incoming.length };
}

export async function sendFriendRequest(
  fromUserId: string,
  targetUserId: string
): Promise<ServiceResult<{ id: string; status: FriendRelationship }>> {
  if (!Types.ObjectId.isValid(targetUserId)) {
    return { ok: false, status: StatusCodes.BAD_REQUEST, message: 'Invalid user id' };
  }
  if (fromUserId === targetUserId) {
    return { ok: false, status: StatusCodes.BAD_REQUEST, message: 'You cannot add yourself' };
  }

  const target = await UserModel.findById(targetUserId).select('_id').lean();
  if (!target) {
    return { ok: false, status: StatusCodes.NOT_FOUND, message: 'User not found' };
  }

  const [userLow, userHigh] = sortUserPair(fromUserId, targetUserId);
  const existing = await FriendConnectionModel.findOne({ userLow, userHigh });

  if (existing) {
    if (existing.status === 'accepted') {
      return { ok: false, status: StatusCodes.CONFLICT, message: 'You are already friends' };
    }
    if (existing.status === 'pending') {
      if (String(existing.initiatedBy) === fromUserId) {
        return {
          ok: true,
          data: { id: String(existing._id), status: 'pending_outgoing' }
        };
      }
      return {
        ok: false,
        status: StatusCodes.CONFLICT,
        message: 'This user already sent you a friend request. Accept it from your requests list.'
      };
    }
    existing.status = 'pending';
    existing.initiatedBy = new Types.ObjectId(fromUserId);
    existing.respondedAt = undefined;
    await existing.save();
    return { ok: true, data: { id: String(existing._id), status: 'pending_outgoing' } };
  }

  const created = await FriendConnectionModel.create({
    userLow,
    userHigh,
    status: 'pending',
    initiatedBy: fromUserId
  });

  return { ok: true, data: { id: String(created._id), status: 'pending_outgoing' } };
}

export async function acceptFriendRequest(
  connectionId: string,
  userId: string
): Promise<ServiceResult<{ peerUserId: string }>> {
  if (!Types.ObjectId.isValid(connectionId)) {
    return { ok: false, status: StatusCodes.BAD_REQUEST, message: 'Invalid request id' };
  }

  const row = await FriendConnectionModel.findById(connectionId);
  if (!row || row.status !== 'pending') {
    return { ok: false, status: StatusCodes.NOT_FOUND, message: 'Friend request not found' };
  }

  const low = String(row.userLow);
  const high = String(row.userHigh);
  if (low !== userId && high !== userId) {
    return { ok: false, status: StatusCodes.FORBIDDEN, message: 'Forbidden' };
  }
  if (String(row.initiatedBy) === userId) {
    return { ok: false, status: StatusCodes.BAD_REQUEST, message: 'You cannot accept your own request' };
  }

  const requesterId = String(row.initiatedBy);
  row.status = 'accepted';
  row.respondedAt = new Date();
  await row.save();

  await ensureDmConversation(low, high, userId);

  return { ok: true, data: { peerUserId: requesterId } };
}

export async function ignoreFriendRequest(
  connectionId: string,
  userId: string
): Promise<ServiceResult<{ peerUserId: string }>> {
  if (!Types.ObjectId.isValid(connectionId)) {
    return { ok: false, status: StatusCodes.BAD_REQUEST, message: 'Invalid request id' };
  }

  const row = await FriendConnectionModel.findById(connectionId);
  if (!row || row.status !== 'pending') {
    return { ok: false, status: StatusCodes.NOT_FOUND, message: 'Friend request not found' };
  }

  const low = String(row.userLow);
  const high = String(row.userHigh);
  if (low !== userId && high !== userId) {
    return { ok: false, status: StatusCodes.FORBIDDEN, message: 'Forbidden' };
  }
  if (String(row.initiatedBy) === userId) {
    return { ok: false, status: StatusCodes.BAD_REQUEST, message: 'You cannot ignore your own request' };
  }

  const requesterId = String(row.initiatedBy);
  await purgeDmBetweenUsers(low, high);

  row.status = 'ignored';
  row.respondedAt = new Date();
  await row.save();

  return { ok: true, data: { peerUserId: requesterId } };
}
