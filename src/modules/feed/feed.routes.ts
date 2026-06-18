import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { getFeedForUser } from './feed.service';

export const feedRouter = Router();

feedRouter.get('/feed', requireAuth, async (req: AuthedRequest, res) => {
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;

  const { items, nextCursor } = await getFeedForUser(req.auth!.userId, cursor, limit);

  return res.json({
    success: true,
    data: items,
    cursor: nextCursor
  });
});

