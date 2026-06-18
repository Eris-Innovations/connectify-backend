import { Router } from 'express';
import type { AuthedRequest } from '../../middleware/auth';
import { requireAuth } from '../../middleware/auth';
import { SecretPrekeyModel } from './secret-prekey.model';

export const secretPrekeyRouter = Router();

// Upload or rotate prekeys (opaque to server)
secretPrekeyRouter.post('/crypto/prekeys', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const bundleId = typeof req.body.bundleId === 'string' ? req.body.bundleId : '';
  const blobBase64 = typeof req.body.blob === 'string' ? req.body.blob : '';
  const ttlSeconds = Number.isFinite(Number(req.body.ttlSeconds)) ? Number(req.body.ttlSeconds) : 60 * 60 * 24 * 30;

  if (!bundleId || !blobBase64) {
    return res.status(400).json({ success: false, message: 'bundleId and blob are required' });
  }

  const blob = Buffer.from(blobBase64, 'base64');
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await SecretPrekeyModel.create({
    userId,
    bundleId,
    blob,
    expiresAt
  });

  return res.status(201).json({ success: true });
});

// Fetch one unused prekey bundle for a peer
secretPrekeyRouter.post('/crypto/prekeys/consume', requireAuth, async (req: AuthedRequest, res) => {
  const peerUserId = typeof req.body.userId === 'string' ? req.body.userId : '';
  if (!peerUserId) {
    return res.status(400).json({ success: false, message: 'userId is required' });
  }

  const prekey = await SecretPrekeyModel.findOneAndUpdate(
    { userId: peerUserId, used: false, expiresAt: { $gt: new Date() } },
    { used: true },
    { sort: { createdAt: 1 }, new: true }
  ).lean();

  if (!prekey) {
    return res.status(404).json({ success: false, message: 'No prekey available' });
  }

  return res.json({
    success: true,
    data: {
      bundleId: prekey.bundleId,
      blob: prekey.blob.toString('base64')
    }
  });
});

