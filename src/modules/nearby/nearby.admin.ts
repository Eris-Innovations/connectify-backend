import { Types } from 'mongoose';
import { resolveStoredMediaUrl } from '../../lib/r2';
import { UserModel } from '../users/user.model';
import { isNearbyFresh } from './nearby.shared';

export type NearbyAdminPerson = {
  id: string;
  name: string;
  username: string;
  email: string;
  avatarUrl: string;
  lat: number;
  lng: number;
  updatedAt: string;
  fresh: boolean;
};

type AdminScope = {
  _id: Types.ObjectId;
  role: string;
  adminScope?: 'global' | 'assigned';
};

/** Lists opted-in Nearby locations for the admin map (scoped for assigned admins). */
export async function listNearbyForAdmin(actor: AdminScope): Promise<NearbyAdminPerson[]> {
  const query: Record<string, unknown> = {
    nearbyEnabled: true,
    'nearbyLocation.type': 'Point',
  };
  if (actor.role !== 'super_admin' && actor.adminScope !== 'global') {
    query.role = 'user';
    query.assignedAdminId = actor._id;
  }

  const users = await UserModel.find(query)
    .select('name username email avatar nearbyLocation nearbyUpdatedAt')
    .sort({ nearbyUpdatedAt: -1 })
    .limit(500)
    .lean();

  const people: NearbyAdminPerson[] = [];
  for (const user of users) {
    const coordinates = user.nearbyLocation?.coordinates;
    const lng = coordinates?.[0];
    const lat = coordinates?.[1];
    if (typeof lat !== 'number' || typeof lng !== 'number' || !user.nearbyUpdatedAt) continue;
    people.push({
      id: String(user._id),
      name: user.name,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatar ? await resolveStoredMediaUrl(user.avatar) : '',
      lat,
      lng,
      updatedAt: new Date(user.nearbyUpdatedAt).toISOString(),
      fresh: isNearbyFresh(user.nearbyUpdatedAt),
    });
  }
  return people;
}
