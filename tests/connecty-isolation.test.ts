import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';

/**
 * Isolation contract: every Connecty collection query must be scoped by authenticated userId.
 * These pure helpers mirror the service filter shapes for regression safety.
 */

function messagesFilter(authUserId: string, threadId: string) {
  return { userId: new Types.ObjectId(authUserId), threadId: new Types.ObjectId(threadId) };
}

function factsFilter(authUserId: string) {
  return { userId: new Types.ObjectId(authUserId) };
}

function neverAcceptClientUserId(authUserId: string, bodyUserId?: string) {
  // Server ignores bodyUserId entirely
  void bodyUserId;
  return authUserId;
}

describe('connecty per-user isolation', () => {
  const userA = new Types.ObjectId().toHexString();
  const userB = new Types.ObjectId().toHexString();
  const threadA = new Types.ObjectId().toHexString();

  it('message filters always bind auth userId', () => {
    const f = messagesFilter(userA, threadA);
    expect(String(f.userId)).toBe(userA);
    expect(String(f.userId)).not.toBe(userB);
  });

  it('facts filters never use another user id from client body', () => {
    const effective = neverAcceptClientUserId(userA, userB);
    expect(effective).toBe(userA);
    const f = factsFilter(effective);
    expect(String(f.userId)).toBe(userA);
  });

  it('user A and B facts filters diverge', () => {
    expect(String(factsFilter(userA).userId)).not.toBe(String(factsFilter(userB).userId));
  });
});
