/**
 * Allows requests from any `Origin` (browsers, Expo web, admin dashboards, etc.) and requests
 * with no `Origin` header (native Android/iOS, curl, Postman).
 *
 * Security note: tighten this (whitelist) if the API is only meant for known frontends.
 */
export function resolveCorsOrigin(
  _origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void
): void {
  callback(null, true);
}
