import { randomUUID } from 'crypto';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { env } from '../../config/env';
import { isR2S3CompatibleAccessKeyId, R2_S3_CREDENTIALS_HELP } from '../../config/r2Credentials';
import { buildPublicUrl, getR2Client, hasR2Config, presignGetUrl } from '../../lib/r2';
import { extensionForMime, folderForMime, isAllowedMediaMime } from './media-mime';

export const mediaRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB for video/docs
});

mediaRouter.post('/media/upload', requireAuth, upload.single('file'), async (req: AuthedRequest, res) => {
  const r2Client = getR2Client();
  if (!r2Client || !hasR2Config) {
    return res.status(503).json({
      success: false,
      message: 'Media storage is not configured'
    });
  }

  if (env.R2_ACCESS_KEY_ID && !isR2S3CompatibleAccessKeyId(env.R2_ACCESS_KEY_ID)) {
    return res.status(503).json({
      success: false,
      message: `Invalid R2 S3 credentials. ${R2_S3_CREDENTIALS_HELP}`,
    });
  }

  const file = (req as AuthedRequest & { file?: Express.Multer.File }).file;
  if (!file) {
    return res.status(400).json({ success: false, message: 'file is required' });
  }

  if (!isAllowedMediaMime(file.mimetype)) {
    return res.status(400).json({ success: false, message: 'Unsupported media type' });
  }

  const ext =
    extensionForMime(file.mimetype) ??
    (path.extname(file.originalname || '').toLowerCase() || '.bin');
  const folder = folderForMime(file.mimetype);
  const key = `uploads/${folder}/${req.auth!.userId}/${Date.now()}-${randomUUID()}${ext}`;

  try {
    await r2Client.send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        CacheControl: 'public, max-age=31536000, immutable'
      })
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === 'object' && 'Code' in err ? String((err as { Code: unknown }).Code) : '';
    if (
      msg.includes('access key') ||
      msg.includes('Access Key') ||
      msg.includes('Credential') ||
      code === 'InvalidArgument'
    ) {
      console.error('[R2] Upload failed (credentials or request):', msg);
      return res.status(503).json({
        success: false,
        message: `R2 rejected the request (often: Access Key ID must be 32 chars for S3, not cfat_…). ${R2_S3_CREDENTIALS_HELP}`,
      });
    }
    console.error('[R2] Upload failed:', err);
    return res.status(502).json({ success: false, message: 'Storage upload failed. Try again later.' });
  }

  const url = buildPublicUrl(key);
  const accessUrl = await presignGetUrl(url);

  return res.status(201).json({
    success: true,
    data: {
      url,
      accessUrl,
      key,
      mimeType: file.mimetype,
      size: file.size
    }
  });
});
