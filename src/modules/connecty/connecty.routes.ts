import { Router, type Response } from 'express';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { env } from '../../config/env';
import { checkConnectyDailyCap, checkConnectyRateLimit } from './connecty.rate-limit';
import {
  getConnectyProfile,
  listConnectyMessages,
  sendConnectyMessage,
  sendConnectyMessageStream,
  clearConnectyMemory,
  pinConnectyMemory,
  unpinConnectyMemory,
  pinConnectyText
} from './connecty.service';
import { probeLlmProviders } from './connecty.llm';

export const connectyRouter = Router();

connectyRouter.use('/connecty', requireAuth);

function writeSse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** Debug: which free LLMs are configured and whether a 1-token ping works. No secrets returned. */
connectyRouter.get('/connecty/llm-status', async (_req: AuthedRequest, res) => {
  if (!env.CONNECTY_ENABLED) {
    return res.status(503).json({ success: false, message: 'Connecty is disabled' });
  }
  const data = await probeLlmProviders();
  return res.json({ success: true, data });
});

connectyRouter.get('/connecty/me', async (req: AuthedRequest, res) => {
  if (!env.CONNECTY_ENABLED) {
    return res.status(503).json({ success: false, message: 'Connecty is disabled' });
  }
  const data = await getConnectyProfile(req.auth!.userId);
  return res.json({ success: true, data });
});

connectyRouter.get('/connecty/messages', async (req: AuthedRequest, res) => {
  if (!env.CONNECTY_ENABLED) {
    return res.status(503).json({ success: false, message: 'Connecty is disabled' });
  }
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const before = typeof req.query.before === 'string' ? req.query.before : undefined;
  const data = await listConnectyMessages(req.auth!.userId, {
    limit: Number.isFinite(limit) ? limit : 50,
    before
  });
  return res.json({ success: true, data });
});

connectyRouter.post('/connecty/messages', async (req: AuthedRequest, res) => {
  if (!env.CONNECTY_ENABLED) {
    return res.status(503).json({ success: false, message: 'Connecty is disabled' });
  }

  const rl = await checkConnectyRateLimit(req.auth!.userId);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return res.status(429).json({
      success: false,
      message: 'Whoa, slow down — give me a sec.',
      retryAfterSec: rl.retryAfterSec
    });
  }

  const daily = await checkConnectyDailyCap(req.auth!.userId);
  if (!daily.ok) {
    return res.status(429).json({
      success: false,
      message: "we've talked a lot today — let's pick this up tomorrow?"
    });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId : undefined;
  try {
    const data = await sendConnectyMessage(req.auth!.userId, text, { clientId });
    return res.json({ success: true, data: { ...data, dailyRemaining: daily.remaining } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SEND_FAILED';
    if (msg === 'EMPTY_TEXT') {
      return res.status(400).json({ success: false, message: 'text is required' });
    }
    if (msg === 'TEXT_TOO_LONG') {
      return res.status(400).json({ success: false, message: 'text too long' });
    }
    throw err;
  }
});

/** SSE streaming replies (Groq stream preferred). */
connectyRouter.post('/connecty/messages/stream', async (req: AuthedRequest, res) => {
  if (!env.CONNECTY_ENABLED) {
    return res.status(503).json({ success: false, message: 'Connecty is disabled' });
  }

  const rl = await checkConnectyRateLimit(req.auth!.userId);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return res.status(429).json({
      success: false,
      message: 'Whoa, slow down — give me a sec.',
      retryAfterSec: rl.retryAfterSec
    });
  }

  const daily = await checkConnectyDailyCap(req.auth!.userId);
  if (!daily.ok) {
    return res.status(429).json({
      success: false,
      message: "we've talked a lot today — let's pick this up tomorrow?"
    });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId : undefined;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof (res as Response & { flushHeaders?: () => void }).flushHeaders === 'function') {
    (res as Response & { flushHeaders: () => void }).flushHeaders();
  }

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  try {
    await sendConnectyMessageStream(
      req.auth!.userId,
      text,
      {
        onUserAck: (userMessage) => {
          if (!closed) writeSse(res, 'user_ack', { userMessage });
        },
        onToken: (delta) => {
          if (!closed) writeSse(res, 'token', { delta });
        },
        onDone: (payload) => {
          if (!closed) {
            writeSse(res, 'done', { ...payload, dailyRemaining: daily.remaining });
            res.end();
          }
        },
        onError: (message) => {
          if (!closed) {
            writeSse(res, 'error', { message });
            res.end();
          }
        }
      },
      { clientId }
    );
  } catch (err) {
    if (!closed) {
      writeSse(res, 'error', {
        message: err instanceof Error ? err.message : 'stream failed'
      });
      res.end();
    }
  }
});

connectyRouter.delete('/connecty/memory', async (req: AuthedRequest, res) => {
  if (!env.CONNECTY_ENABLED) {
    return res.status(503).json({ success: false, message: 'Connecty is disabled' });
  }
  const wipeMessages = req.query.messages === '1' || req.body?.wipeMessages === true;
  const data = await clearConnectyMemory(req.auth!.userId, { wipeMessages });
  return res.json({ success: true, data });
});

connectyRouter.post('/connecty/memory/pin', async (req: AuthedRequest, res) => {
  if (!env.CONNECTY_ENABLED) {
    return res.status(503).json({ success: false, message: 'Connecty is disabled' });
  }
  const key = typeof req.body?.key === 'string' ? req.body.key : '';
  const value = typeof req.body?.value === 'string' ? req.body.value : '';
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  try {
    if (text && !key) {
      const data = await pinConnectyText(req.auth!.userId, text);
      return res.json({ success: true, data });
    }
    const data = await pinConnectyMemory(req.auth!.userId, key, value);
    return res.json({ success: true, data });
  } catch {
    return res.status(400).json({ success: false, message: 'key and value (or text) are required' });
  }
});

connectyRouter.delete('/connecty/memory/pin', async (req: AuthedRequest, res) => {
  if (!env.CONNECTY_ENABLED) {
    return res.status(503).json({ success: false, message: 'Connecty is disabled' });
  }
  const key = typeof req.body?.key === 'string' ? req.body.key : typeof req.query.key === 'string' ? req.query.key : '';
  try {
    const data = await unpinConnectyMemory(req.auth!.userId, key);
    return res.json({ success: true, data });
  } catch {
    return res.status(400).json({ success: false, message: 'key is required' });
  }
});
