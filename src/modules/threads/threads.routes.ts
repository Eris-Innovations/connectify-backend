import { Router } from 'express';
import type { AuthedRequest } from '../../middleware/auth';
import { requireAuth } from '../../middleware/auth';
import { MessageModel } from '../messages/message.model';
import { aiService } from '../ai/ai.service';

export const threadsRouter = Router();

threadsRouter.post('/threads/:conversationId/summarise', requireAuth, async (req: AuthedRequest, res) => {
  const conversationId = req.params.conversationId;
  const userId = req.auth!.userId;

  const messages = await MessageModel.find({
    conversationId,
    isSecret: { $ne: true }
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  if (!messages.length) {
    return res.status(400).json({ success: false, message: 'Not enough messages to summarise' });
  }

  const text = messages
    .map((m) => `${String(m.senderId) === userId ? 'You' : 'Participant'}: ${m.content?.text ?? ''}`)
    .join('\n');

  try {
    const summary = await aiService.summariseThread(text);
    return res.json({ success: true, data: summary });
  } catch (error) {
    console.error('Failed to summarise thread', error);
    return res.status(500).json({ success: false, message: 'Failed to summarise thread' });
  }
});

