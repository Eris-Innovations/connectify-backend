import { Types } from 'mongoose';
import { UserBlockModel } from './user-block.model';

export async function getBlockedUserIds(userId: string): Promise<string[]> {
  const rows = await UserBlockModel.find({ blockerId: new Types.ObjectId(userId) })
    .select('blockedId')
    .lean();
  return rows.map((r) => String(r.blockedId));
}

export async function getBlockedByUserIds(userId: string): Promise<string[]> {
  const rows = await UserBlockModel.find({ blockedId: new Types.ObjectId(userId) })
    .select('blockerId')
    .lean();
  return rows.map((r) => String(r.blockerId));
}

/** Users this person must not see (they blocked, or blocked them). */
export async function getMutualBlockIds(userId: string): Promise<Set<string>> {
  const [blocked, blockedBy] = await Promise.all([
    getBlockedUserIds(userId),
    getBlockedByUserIds(userId)
  ]);
  return new Set([...blocked, ...blockedBy]);
}

export async function isEitherBlocked(a: string, b: string): Promise<boolean> {
  if (!a || !b || a === b) return false;
  const hit = await UserBlockModel.exists({
    $or: [
      { blockerId: new Types.ObjectId(a), blockedId: new Types.ObjectId(b) },
      { blockerId: new Types.ObjectId(b), blockedId: new Types.ObjectId(a) }
    ]
  });
  return Boolean(hit);
}
