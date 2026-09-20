export type ChannelKind = 'broadcast' | 'legacy';

export function effectiveChannelKind(channel: { kind?: string | null }): ChannelKind {
  return channel.kind === 'broadcast' ? 'broadcast' : 'legacy';
}

export function isBroadcastChannel(channel: { kind?: string | null }): boolean {
  return effectiveChannelKind(channel) === 'broadcast';
}

export function isChannelAdmin(
  channel: { ownerId: unknown; admins?: unknown[] | null },
  userId: string
): boolean {
  const uid = String(userId);
  if (String(channel.ownerId) === uid) return true;
  return (channel.admins ?? []).some((id) => String(id) === uid);
}

export function isChannelFollower(
  channel: { followers?: unknown[] | null },
  userId: string
): boolean {
  const uid = String(userId);
  return (channel.followers ?? []).some((id) => String(id) === uid);
}
