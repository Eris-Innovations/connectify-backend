import { Types } from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { CommunityModel } from '../src/modules/communities/community.model';
import { ConversationModel } from '../src/modules/messages/conversation.model';

describe('broadcast channel HTTP auth gates', () => {
  const app = createApp();
  const id = new Types.ObjectId().toString();

  it('requires auth to create a channel', async () => {
    const response = await request(app).post(`${env.API_PREFIX}/channels`).send({ name: 'News' });
    expect(response.status).toBe(401);
  });

  it('requires auth to follow / unfollow / post', async () => {
    expect((await request(app).post(`${env.API_PREFIX}/channels/${id}/follow`)).status).toBe(401);
    expect((await request(app).post(`${env.API_PREFIX}/channels/${id}/unfollow`)).status).toBe(401);
    expect(
      (await request(app).post(`${env.API_PREFIX}/channels/${id}/posts`).send({ text: 'hi' })).status
    ).toBe(401);
    expect((await request(app).get(`${env.API_PREFIX}/channels/${id}/posts`)).status).toBe(401);
  });
});

describe('communities models + HTTP auth gates', () => {
  const app = createApp();

  it('requires announcement group and members on community docs', () => {
    const ownerId = new Types.ObjectId();
    const announcementGroupId = new Types.ObjectId();
    const community = new CommunityModel({
      name: 'Campus',
      ownerId,
      announcementGroupId,
      memberIds: [ownerId],
    });
    expect(community.validateSync()).toBeUndefined();
  });

  it('stores announcement flags on conversations', () => {
    const ownerId = new Types.ObjectId();
    const communityId = new Types.ObjectId();
    const conv = new ConversationModel({
      type: 'group',
      title: 'Campus · Announcements',
      participants: [{ userId: ownerId, role: 'owner' }],
      createdBy: ownerId,
      communityId,
      isAnnouncementGroup: true,
    });
    expect(conv.validateSync()).toBeUndefined();
    expect(conv.isAnnouncementGroup).toBe(true);
  });

  it('requires auth for community create and join', async () => {
    const id = new Types.ObjectId().toString();
    expect((await request(app).post(`${env.API_PREFIX}/communities`).send({ name: 'X' })).status).toBe(
      401
    );
    expect((await request(app).post(`${env.API_PREFIX}/communities/${id}/join`)).status).toBe(401);
    expect((await request(app).get(`${env.API_PREFIX}/communities/${id}`)).status).toBe(401);
  });

  it('requires auth to invite community members', async () => {
    const id = new Types.ObjectId().toString();
    expect(
      (
        await request(app)
          .post(`${env.API_PREFIX}/communities/${id}/members`)
          .send({ userIds: [new Types.ObjectId().toString()] })
      ).status
    ).toBe(401);
  });
});
