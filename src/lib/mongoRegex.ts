/** Escape a user-supplied string for safe use as a literal inside MongoDB `$regex`. */
export function escapeMongoRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Keep search queries bounded to reduce ReDoS impact and load. */
export const MAX_SEARCH_QUERY_LENGTH = 200;

export function clampSearchQuery(q: string): string {
  const t = q.trim();
  if (t.length <= MAX_SEARCH_QUERY_LENGTH) return t;
  return t.slice(0, MAX_SEARCH_QUERY_LENGTH);
}
