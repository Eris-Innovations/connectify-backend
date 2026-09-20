import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { ConversationModel } from '../messages/conversation.model';
import { areFriends } from '../friends/friends.service';
import { CommunityModel } from './community.model';
import { clampSearchQuery, escapeMongoRegex } from '../../lib/mongoRegex';

export const communitiesRouter = Router();

const MAX_INVITE_MEMBERS = 20;

function isCommunityAdmin(
  community: { ownerId: unknown; admins?: unknown[] },
  userId: string
): boolean {
  const uid = String(userId);
  if (String(community.ownerId) === uid) return true;
  return (community.admins ?? []).some((id) => String(id) === uid);
}

function mapCommunity(c: any, userId?: string) {
  const memberIds = (c.memberIds ?? []).map((id: any) => String(id));
  return {
    id: String(c._id),
    name: c.name,
    description: c.description ?? '',
    avatar: c.avatar ?? '',
    ownerId: String(c.ownerId),
    announcementGroupId: String(c.announcementGroupId),
    groupIds: (c.groupIds ?? []).map((id: any) => String(id)),
    memberIds,
    memberCount: memberIds.length,
    isPublic: Boolean(c.isPublic),
    isMember: userId ? memberIds.includes(userId) : false,
    isAdmin: userId ? isCommunityAdmin(c, userId) : false,
  };
}

communitiesRouter.get('/communities', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const q = clampSearchQuery(typeof req.query.q === 'string' ? req.query.q : '');
  const literal = q ? escapeMongoRegex(q) : '';
  const mine = req.query.mine === '1' || req.query.mine === 'true';

  const and: Record<string, unknown>[] = [];
  if (literal) {
    and.push({
      $or: [
        { name: { $regex: literal, $options: 'i' } },
        { description: { $regex: literal, $options: 'i' } },
      ],
    });
  }
  if (mine) {
    and.push({ memberIds: userId });
  } else {
    and.push({ $or: [{ isPublic: true }, { memberIds: userId }] });
  }

  const query = and.length ? { $and: and } : {};
  const rows = await CommunityModel.find(query).sort({ createdAt: -1 }).limit(50).lean();
  return res.json({ success: true, data: rows.map((c) => mapCommunity(c, userId)) });
});

communitiesRouter.post('/communities', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
  const description =
    typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 500) : '';

  if (!name) {
    return res.status(400).json({ success: false, message: 'Community name is required' });
  }

  const uid = new Types.ObjectId(userId);
  const announcements = await ConversationModel.create({
    type: 'group',
    title: `${name} · Announcements`,
    description: 'Community announcements',
    participants: [{ userId: uid, role: 'owner' }],
    createdBy: uid,
    isAnnouncementGroup: true,
  });

  const community = await CommunityModel.create({
    name,
    description,
    ownerId: uid,
    admins: [],
    memberIds: [uid],
    announcementGroupId: announcements._id,
    groupIds: [],
    isPublic: true,
  });

  announcements.communityId = community._id as any;
  await announcements.save();

  return res.status(201).json({
    success: true,
    data: mapCommunity(community.toObject(), userId),
  });
});

communitiesRouter.get('/communities/:id', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const userId = req.auth!.userId;
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!rawId || !Types.ObjectId.isValid(rawId)) {
      return res.status(400).json({ success: false, message: 'Invalid community id' });
    }

    const community = await CommunityModel.findById(rawId).lean();
    if (!community) return res.status(404).json({ success: false, message: 'Community not found' });

    const groupIds = [...(community.groupIds ?? []), community.announcementGroupId].filter(Boolean);
    const groups = await ConversationModel.find({ _id: { $in: groupIds }, type: 'group' })
      .select('title avatar participants communityId isAnnouncementGroup')
      .lean();

    const groupSummaries = groups.map((g) => {
      const participants = Array.isArray(g.participants) ? g.participants : [];
      const isMember = participants.some((p: any) => {
        const raw = p?.userId;
        if (!raw) return false;
        const pid = typeof raw === 'object' && raw._id != null ? String(raw._id) : String(raw);
        return pid === userId;
      });
      return {
        id: String(g._id),
        title: g.title || 'Group',
        avatar: g.avatar || '',
        isAnnouncement: Boolean(g.isAnnouncementGroup) || String(g._id) === String(community.announcementGroupId),
        memberCount: participants.length,
        isMember,
      };
    });

    return res.json({
      success: true,
      data: {
        ...mapCommunity(community, userId),
        groups: groupSummaries,
      },
    });
  } catch (error) {
    console.error('Failed to fetch community', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

communitiesRouter.post('/communities/:id/join', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const community = await CommunityModel.findById(req.params.id);
  if (!community) return res.status(404).json({ success: false, message: 'Community not found' });

  const uid = new Types.ObjectId(userId);
  if (community.memberIds.some((m) => String(m) === userId)) {
    return res.status(409).json({ success: false, message: 'Already a member' });
  }
  if (!community.isPublic && !isCommunityAdmin(community, userId)) {
    return res.status(403).json({ success: false, message: 'This community is private' });
  }

  community.memberIds.push(uid);
  await community.save();

  await ConversationModel.updateOne(
    { _id: community.announcementGroupId, 'participants.userId': { $ne: uid } },
    { $push: { participants: { userId: uid, role: 'member' } } }
  );

  return res.json({ success: true, data: mapCommunity(community.toObject(), userId) });
});

/** Admin/owner adds accepted friends directly (announcements group only). */
communitiesRouter.post('/communities/:id/members', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const community = await CommunityModel.findById(req.params.id);
  if (!community) return res.status(404).json({ success: false, message: 'Community not found' });
  if (!isCommunityAdmin(community, userId)) {
    return res.status(403).json({ success: false, message: 'Only community admins can invite members' });
  }

  const raw = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
  const userIds = Array.from(
    new Set(
      raw
        .map((id: unknown) => String(id ?? '').trim())
        .filter((id: string) => id.length > 0)
    )
  ) as string[];
  if (userIds.length === 0) {
    return res.status(400).json({ success: false, message: 'userIds required' });
  }
  if (userIds.length > MAX_INVITE_MEMBERS) {
    return res.status(400).json({
      success: false,
      message: `At most ${MAX_INVITE_MEMBERS} userIds`,
    });
  }

  let added = 0;
  let skipped = 0;
  let skippedAlready = 0;
  let skippedNotFriend = 0;

  for (const targetId of userIds) {
    if (targetId === userId || !Types.ObjectId.isValid(targetId)) {
      skipped += 1;
      continue;
    }
    if (community.memberIds.some((m) => String(m) === targetId)) {
      skipped += 1;
      skippedAlready += 1;
      continue;
    }
    const friends = await areFriends(userId, targetId);
    if (!friends) {
      skipped += 1;
      skippedNotFriend += 1;
      continue;
    }
    const uid = new Types.ObjectId(targetId);
    community.memberIds.push(uid);
    await ConversationModel.updateOne(
      { _id: community.announcementGroupId, 'participants.userId': { $ne: uid } },
      { $push: { participants: { userId: uid, role: 'member' } } }
    );
    added += 1;
  }

  if (added === 0) {
    const message =
      skippedAlready > 0 && skippedAlready === skipped
        ? 'Member already added to this community'
        : skippedAlready > 0
          ? 'Selected friends are already members'
          : 'No members added (need accepted friends who are not already members)';
    return res.status(skippedAlready > 0 ? 409 : 400).json({
      success: false,
      message,
      errorCode: skippedAlready > 0 ? 'ALREADY_MEMBER' : 'NO_MEMBERS_ADDED',
      data: { added: 0, skipped, skippedAlready, skippedNotFriend },
    });
  }

  await community.save();
  return res.json({
    success: true,
    data: {
      ...mapCommunity(community.toObject(), userId),
      added,
      skipped,
      skippedAlready,
      skippedNotFriend,
    },
  });
});

communitiesRouter.post('/communities/:id/groups', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const community = await CommunityModel.findById(req.params.id);
  if (!community) return res.status(404).json({ success: false, message: 'Community not found' });
  if (!isCommunityAdmin(community, userId)) {
    return res.status(403).json({ success: false, message: 'Only community admins can link groups' });
  }

  const groupId = typeof req.body?.groupId === 'string' ? req.body.groupId.trim() : '';
  if (!groupId || !Types.ObjectId.isValid(groupId)) {
    return res.status(400).json({ success: false, message: 'Valid groupId required' });
  }
  if (String(community.announcementGroupId) === groupId) {
    return res.status(400).json({ success: false, message: 'Cannot link the announcements group again' });
  }
  if (community.groupIds.some((id) => String(id) === groupId)) {
    return res.status(409).json({ success: false, message: 'Group already linked' });
  }

  const group = await ConversationModel.findById(groupId);
  if (!group || group.type !== 'group') {
    return res.status(404).json({ success: false, message: 'Group not found' });
  }
  const me = group.participants.find((p) => String(p.userId) === userId);
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
    return res.status(403).json({ success: false, message: 'You must admin the group to link it' });
  }

  community.groupIds.push(group._id as any);
  await community.save();
  group.communityId = community._id as any;
  await group.save();

  return res.json({ success: true, data: mapCommunity(community.toObject(), userId) });
});

/** Community member opts into a linked group (not auto-added on community join). */
communitiesRouter.post('/communities/:id/groups/:groupId/join', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const communityId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const groupId = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;

  if (!communityId || !Types.ObjectId.isValid(communityId) || !groupId || !Types.ObjectId.isValid(groupId)) {
    return res.status(400).json({ success: false, message: 'Valid community and group ids required' });
  }

  const community = await CommunityModel.findById(communityId);
  if (!community) return res.status(404).json({ success: false, message: 'Community not found' });

  const isMember = community.memberIds.some((m) => String(m) === userId);
  if (!isMember) {
    return res.status(403).json({ success: false, message: 'Join the community first' });
  }

  const linked =
    String(community.announcementGroupId) === groupId ||
    community.groupIds.some((id) => String(id) === groupId);
  if (!linked) {
    return res.status(404).json({ success: false, message: 'Group is not part of this community' });
  }

  const group = await ConversationModel.findById(groupId);
  if (!group || group.type !== 'group') {
    return res.status(404).json({ success: false, message: 'Group not found' });
  }

  if (group.participants.some((p) => String(p.userId) === userId)) {
    return res.status(409).json({ success: false, message: 'Already in this group' });
  }

  const uid = new Types.ObjectId(userId);
  group.participants.push({ userId: uid, role: 'member', joinedAt: new Date() } as any);
  await group.save();

  return res.json({
    success: true,
    data: {
      id: String(group._id),
      title: group.title || 'Group',
      isAnnouncement:
        Boolean(group.isAnnouncementGroup) || String(group._id) === String(community.announcementGroupId),
      memberCount: group.participants.length,
      isMember: true,
    },
  });
});

communitiesRouter.delete(
  '/communities/:id/groups/:groupId',
  requireAuth,
  async (req: AuthedRequest, res) => {
    const userId = req.auth!.userId;
    const community = await CommunityModel.findById(req.params.id);
    if (!community) return res.status(404).json({ success: false, message: 'Community not found' });
    if (!isCommunityAdmin(community, userId)) {
      return res.status(403).json({ success: false, message: 'Only community admins can unlink groups' });
    }

    const groupId = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
    if (!groupId || String(community.announcementGroupId) === groupId) {
      return res.status(400).json({ success: false, message: 'Cannot unlink announcements group' });
    }

    const before = community.groupIds.length;
    community.groupIds = community.groupIds.filter((id) => String(id) !== groupId);
    if (community.groupIds.length === before) {
      return res.status(404).json({ success: false, message: 'Group not linked' });
    }
    await community.save();
    if (Types.ObjectId.isValid(groupId)) {
      await ConversationModel.updateOne(
        { _id: groupId, communityId: community._id },
        { $unset: { communityId: '' } }
      );
    }
    return res.json({ success: true, data: mapCommunity(community.toObject(), userId) });
  }
);
