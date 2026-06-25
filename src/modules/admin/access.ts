import type { Response } from 'express';
import { Types } from 'mongoose';
import type { AuthedRequest } from '../../middleware/auth';
import { UserModel } from '../users/user.model';
import { ConversationModel } from '../messages/conversation.model';
import { resolveVirtualConversationId } from '../../lib/conversationIds';

export type AdminCapability =
  | 'user_management'
  | 'admin_management'
  | 'analytics'
  | 'channels'
  | 'moderation'
  | 'transcripts';

type AdminActor = {
  _id: Types.ObjectId;
  role: 'user' | 'admin' | 'super_admin' | 'moderator' | 'analyst';
  adminScope?: 'global' | 'assigned';
};

async function loadAdminActor(userId: string): Promise<AdminActor | null> {
  if (!Types.ObjectId.isValid(userId)) return null;
  return UserModel.findById(userId).select('role adminScope').lean<AdminActor | null>();
}

export async function requireAdminCapability(
  req: AuthedRequest,
  res: Response,
  capability: AdminCapability
): Promise<AdminActor | null> {
  const actor = await loadAdminActor(req.auth!.userId);
  if (!actor) {
    res.status(403).json({ success: false, message: 'Forbidden' });
    return null;
  }

  if (actor.role === 'super_admin') return actor;

  switch (capability) {
    case 'admin_management':
      res.status(403).json({ success: false, message: 'Only a super admin can manage admin accounts' });
      return null;
    case 'analytics':
      if (actor.role === 'analyst') return actor;
      break;
    case 'channels':
    case 'moderation':
      if (actor.role === 'moderator') return actor;
      break;
    case 'transcripts':
      break;
    case 'user_management':
      if (actor.role === 'admin') return actor;
      break;
    default:
      break;
  }

  if (actor.role !== 'admin') {
    res.status(403).json({ success: false, message: 'Insufficient admin permissions' });
    return null;
  }

  if (capability === 'user_management') return actor;
  if (actor.adminScope === 'global') return actor;

  res.status(403).json({ success: false, message: 'This admin account is limited to assigned users only' });
  return null;
}

export async function canAdminAccessUser(actor: AdminActor, targetUserId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(targetUserId)) return false;
  if (actor.role === 'super_admin') {
    const row = await UserModel.findOne({ _id: new Types.ObjectId(targetUserId), role: 'user' }).select('_id').lean();
    return Boolean(row);
  }
  if (actor.role !== 'admin') return false;
  if (actor.adminScope === 'global') {
    const row = await UserModel.findOne({ _id: new Types.ObjectId(targetUserId), role: 'user' }).select('_id').lean();
    return Boolean(row);
  }

  const row = await UserModel.findOne({
    _id: new Types.ObjectId(targetUserId),
    role: 'user',
    assignedAdminId: actor._id
  })
    .select('_id')
    .lean();
  return Boolean(row);
}

export async function canAdminAccessConversation(actor: AdminActor, conversationId: string): Promise<boolean> {
  if (actor.role === 'super_admin') return true;
  if (actor.role !== 'admin') return false;
  if (actor.adminScope === 'global') return true;

  const mongoConvId = await resolveVirtualConversationId(conversationId);
  const conversation = await ConversationModel.findById(mongoConvId).select('participants.userId').lean();
  if (!conversation) return false;

  const participantIds = (conversation.participants ?? [])
    .map((participant: any) => String(participant.userId))
    .filter((id: string) => Types.ObjectId.isValid(id));

  if (!participantIds.length) return false;

  const scopedUser = await UserModel.findOne({
    _id: { $in: participantIds.map((id) => new Types.ObjectId(id)) },
    role: 'user',
    assignedAdminId: actor._id
  })
    .select('_id')
    .lean();

  return Boolean(scopedUser);
}
