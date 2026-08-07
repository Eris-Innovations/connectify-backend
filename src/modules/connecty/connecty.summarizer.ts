import { Types } from 'mongoose';
import { ConnectyMessageModel } from './connecty-message.model';
import { ConnectyMemoryChunkModel } from './connecty-chunk.model';
import type { ConnectyThreadDocument } from './connecty-thread.model';
import { connectyChat, embedText, type ChatMessage } from './connecty.llm';

/** Triggers when messages since last summary exceed this many. */
export const SUMMARIZE_EVERY_MESSAGES = 16;

export async function maybeRefreshRunningSummary(opts: {
  userId: string;
  thread: ConnectyThreadDocument;
}): Promise<void> {
  const uid = new Types.ObjectId(opts.userId);
  const threadId = opts.thread._id;

  const sinceFilter: Record<string, unknown> = { userId: uid, threadId };
  if (opts.thread.summaryUpToMessageId) {
    const cursor = await ConnectyMessageModel.findOne({
      _id: opts.thread.summaryUpToMessageId,
      userId: uid
    })
      .select('createdAt')
      .lean();
    if (cursor?.createdAt) {
      sinceFilter.createdAt = { $gt: cursor.createdAt };
    }
  }

  const unsummarized = await ConnectyMessageModel.find(sinceFilter)
    .sort({ createdAt: 1 })
    .select('_id role text createdAt')
    .lean();

  // Keep last window unsummarized; only fold the middle/old segment.
  if (unsummarized.length < SUMMARIZE_EVERY_MESSAGES + 8) return;

  const toFold = unsummarized.slice(0, unsummarized.length - 12);
  if (!toFold.length) return;

  const transcript = toFold.map((m) => `${m.role}: ${m.text}`).join('\n').slice(0, 8000);
  const prev = (opts.thread.runningSummary || '').trim();

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You maintain a running summary of a friendship chat for personal memory.
Update the existing summary with NEW transcript only. Rules:
- Do NOT invent details absent from previous summary + new transcript.
- Keep names, open plans/loops, emotional arc, important commitments.
- Max ~250 words. Plain prose, no bullet dump of every turn.`
    },
    {
      role: 'user',
      content: `PREVIOUS SUMMARY:\n${prev || '(empty)'}\n\nNEW TRANSCRIPT TO FOLD IN:\n${transcript}\n\nWrite the updated running summary only.`
    }
  ];

  const { text } = await connectyChat(messages, { maxTokens: 450 });
  if (!text || text.includes("brain's spinning")) return;

  const lastFolded = toFold[toFold.length - 1]!;
  opts.thread.runningSummary = text.slice(0, 4000);
  opts.thread.summaryUpToMessageId = lastFolded._id as Types.ObjectId;
  await opts.thread.save();

  const embedding = await embedText(text);
  await ConnectyMemoryChunkModel.create({
    userId: uid,
    text: text.slice(0, 1500),
    embedding,
    kind: 'summary',
    sourceMessageIds: toFold.slice(-3).map((m) => m._id as Types.ObjectId)
  });

  // Prune old turn chunks over cap
  const chunkCount = await ConnectyMemoryChunkModel.countDocuments({ userId: uid });
  if (chunkCount > 500) {
    const drop = await ConnectyMemoryChunkModel.find({ userId: uid })
      .sort({ createdAt: 1 })
      .limit(chunkCount - 500)
      .select('_id')
      .lean();
    if (drop.length) {
      await ConnectyMemoryChunkModel.deleteMany({ _id: { $in: drop.map((d) => d._id) } });
    }
  }
}
