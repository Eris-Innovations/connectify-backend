/** Shared live-location validation (API + tests). */

export const LIVE_LOCATION_ALLOWED_DURATIONS_SEC = [900, 3600, 28800] as const;

export type LiveLocationDurationSec = (typeof LIVE_LOCATION_ALLOWED_DURATIONS_SEC)[number];

const ALLOWED = new Set<number>(LIVE_LOCATION_ALLOWED_DURATIONS_SEC);

export function isAllowedLiveLocationDuration(durationSec: number): durationSec is LiveLocationDurationSec {
  return ALLOWED.has(durationSec);
}

export function parseLocationCoord(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return n;
}

export function isValidLatLng(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
