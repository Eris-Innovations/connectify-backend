export const NEARBY_ALLOWED_RADII_M = [100, 500, 1000, 5000] as const;
export type NearbyRadiusM = (typeof NEARBY_ALLOWED_RADII_M)[number];

const ALLOWED = new Set<number>(NEARBY_ALLOWED_RADII_M);

/** Drops stale presence so users who left Nearby stop appearing. Background pings are sparse. */
export const NEARBY_STALE_MS = 30 * 60 * 1000;

/** Admin map “fresh” badge — independent of peer-discovery stale window. */
export const NEARBY_ADMIN_FRESH_MS = 5 * 60 * 1000;

export function isAllowedNearbyRadius(radiusM: number): radiusM is NearbyRadiusM {
  return ALLOWED.has(radiusM);
}

export function parseNearbyCoord(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return n;
}

export function isValidLatLng(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function nearbyStaleCutoff(now = Date.now()): Date {
  return new Date(now - NEARBY_STALE_MS);
}

export function isNearbyFresh(updatedAt: Date | string | null | undefined, now = Date.now()): boolean {
  if (!updatedAt) return false;
  const time = new Date(updatedAt).getTime();
  if (!Number.isFinite(time)) return false;
  return now - time <= NEARBY_ADMIN_FRESH_MS && time <= now + 60_000;
}

/** Haversine distance in meters. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
