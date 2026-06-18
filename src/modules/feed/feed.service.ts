type FeedItem = {
  id: string;
  caption: string;
  imageUrl: string;
  musicLabel?: string;
  locationName?: string;
  locationLat?: number;
  locationLng?: number;
  likes: number;
  comments: number;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    username: string;
    avatarUrl: string;
  } | null;
};

/** Feed posts are disabled; returns an empty list. */
export async function getFeedForUser(
  _userId: string,
  _cursor?: string | null,
  _limitParam?: number
): Promise<{ items: FeedItem[]; nextCursor: string | null }> {
  void _userId;
  void _cursor;
  void _limitParam;
  return { items: [], nextCursor: null };
}

/** Legacy no-op: social feed is disabled. */
export async function addPostToFollowersFeeds(_authorId: string, _postId: string): Promise<void> {
  void _authorId;
  void _postId;
}
