import { Types } from 'mongoose';
import { ConnectyMessageModel } from './connecty-message.model';
import { ConnectyMemoryFactModel } from './connecty-memory.model';
import { ConnectyMemoryChunkModel } from './connecty-chunk.model';
import { cosineSimilarity, embedText } from './connecty.llm';
import type { ConnectyThreadDocument } from './connecty-thread.model';

export const WINDOW_MESSAGE_LIMIT = 36;
export const TOP_FACTS = 20;
export const TOP_CHUNKS = 5;
export const MAX_CHUNKS_SCAN = 400;

export type PackedMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type ContextPack = {
  recentMessages: PackedMessage[];
  factsBlock: string;
  summaryBlock: string;
  ragBlock: string;
  factCount: number;
};

function tokenOverlapScore(query: string, text: string): number {
  const q = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((t) => t.length > 2)
  );
  if (!q.size) return 0;
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 2);
  let hit = 0;
  for (const w of words) {
    if (q.has(w)) hit += 1;
  }
  return hit / q.size;
}

export async function buildContextPack(opts: {
  userId: string;
  thread: ConnectyThreadDocument;
  latestUserText: string;
}): Promise<ContextPack> {
  const uid = new Types.ObjectId(opts.userId);

  const [recentDocs, facts] = await Promise.all([
    ConnectyMessageModel.find({ userId: uid, threadId: opts.thread._id })
      .sort({ createdAt: -1 })
      .limit(WINDOW_MESSAGE_LIMIT)
      .select('role text')
      .lean(),
    ConnectyMemoryFactModel.find({ userId: uid })
      .sort({ importance: -1, lastReinforcedAt: -1 })
      .limit(TOP_FACTS)
      .select('key value category importance')
      .lean()
  ]);

  const recentMessages: PackedMessage[] = recentDocs
    .reverse()
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
    .map((m) => ({
      role: m.role as PackedMessage['role'],
      content: m.text
    }));

  const factsBlock = facts
    .map((f) => `- [${f.category}] ${f.key}: ${f.value}`)
    .join('\n');

  const summaryBlock = (opts.thread.runningSummary || '').trim();

  const queryEmbedding = await embedText(opts.latestUserText);
  const chunks = await ConnectyMemoryChunkModel.find({ userId: uid })
    .sort({ createdAt: -1 })
    .limit(MAX_CHUNKS_SCAN)
    .select('text embedding kind')
    .lean();

  const scored = chunks.map((c) => {
    let score = 0;
    if (queryEmbedding.length && Array.isArray(c.embedding) && c.embedding.length === queryEmbedding.length) {
      score = cosineSimilarity(queryEmbedding, c.embedding as number[]);
    } else {
      score = tokenOverlapScore(opts.latestUserText, c.text) * 0.5;
    }
    return { text: c.text, kind: c.kind, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((s) => s.score > 0.05).slice(0, TOP_CHUNKS);

  const ragBlock = top.map((s, i) => `(${i + 1}) [${s.kind}] ${s.text}`).join('\n');

  return {
    recentMessages,
    factsBlock,
    summaryBlock,
    ragBlock,
    factCount: facts.length
  };
}
