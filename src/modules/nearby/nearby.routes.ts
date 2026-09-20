import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { resolveStoredMediaUrl } from '../../lib/r2';
import { UserModel } from '../users/user.model';
import { getFriendRelationship } from '../friends/friends.service';
import {
  distanceMeters,
  isAllowedNearbyRadius,
  isValidLatLng,
  nearbyStaleCutoff,
  parseNearbyCoord,
} from './nearby.shared';

export const nearbyRouter = Router();

nearbyRouter.post('/nearby/ping', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const lat = parseNearbyCoord(req.body?.lat);
  const lng = parseNearbyCoord(req.body?.lng);
  if (lat == null || lng == null || !isValidLatLng(lat, lng)) {
    return res.status(400).json({ success: false, message: 'Valid lat/lng required' });
  }

  const now = new Date();
  await UserModel.findByIdAndUpdate(userId, {
    $set: {
      nearbyEnabled: true,
      nearbyLocation: { type: 'Point', coordinates: [lng, lat] },
      nearbyUpdatedAt: now,
    },
  });

  return res.json({
    success: true,
    data: { nearbyEnabled: true, lat, lng, updatedAt: now.toISOString() },
  });
});

nearbyRouter.post('/nearby/disable', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  await UserModel.findByIdAndUpdate(userId, {
    $set: { nearbyEnabled: false },
    $unset: { nearbyLocation: '', nearbyUpdatedAt: '' },
  });
  return res.json({ success: true, data: { nearbyEnabled: false } });
});

nearbyRouter.get('/nearby', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const lat = parseNearbyCoord(req.query.lat);
  const lng = parseNearbyCoord(req.query.lng);
  const radiusM = Number(req.query.radius ?? 500);

  if (lat == null || lng == null || !isValidLatLng(lat, lng)) {
    return res.status(400).json({ success: false, message: 'Valid lat/lng query required' });
  }
  if (!isAllowedNearbyRadius(radiusM)) {
    return res.status(400).json({
      success: false,
      message: 'radius must be 100, 500, 1000, or 5000',
    });
  }

  const me = await UserModel.findById(userId).select('nearbyEnabled').lean();
  if (!me?.nearbyEnabled) {
    return res.status(403).json({
      success: false,
      message: 'Enable Nearby and ping your location first',
    });
  }

  const cutoff = nearbyStaleCutoff();
  const rows = await UserModel.find({
    _id: { $ne: new Types.ObjectId(userId) },
    nearbyEnabled: true,
    nearbyUpdatedAt: { $gte: cutoff },
    isSuspended: { $ne: true },
    nearbyLocation: {
      $near: {
        $geometry: { type: 'Point', coordinates: [lng, lat] },
        $maxDistance: radiusM,
      },
    },
  })
    .select('name username avatar nearbyLocation nearbyUpdatedAt')
    .limit(50)
    .lean();

  const data = await Promise.all(
    rows.map(async (u) => {
      const coords = u.nearbyLocation?.coordinates;
      const peerLng = Array.isArray(coords) ? Number(coords[0]) : NaN;
      const peerLat = Array.isArray(coords) ? Number(coords[1]) : NaN;
      const distanceM =
        Number.isFinite(peerLat) && Number.isFinite(peerLng)
          ? distanceMeters(lat, lng, peerLat, peerLng)
          : null;
      const relationship = await getFriendRelationship(userId, String(u._id));
      const avatarUrl = u.avatar ? await resolveStoredMediaUrl(u.avatar) : '';
      return {
        id: String(u._id),
        name: u.name,
        username: u.username,
        avatarUrl,
        distanceM,
        relationship: relationship.status,
        connectionId: relationship.connectionId ?? null,
        nearbyUpdatedAt: u.nearbyUpdatedAt,
      };
    })
  );

  return res.json({ success: true, data, meta: { radiusM, count: data.length } });
});
