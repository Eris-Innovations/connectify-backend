import { Types } from 'mongoose';
import {
  CONNECTY_FACT_CATEGORIES,
  ConnectyMemoryFactModel,
  type ConnectyFactCategory
} from './connecty-memory.model';
import { ConnectyMemoryChunkModel } from './connecty-chunk.model';
import { connectyChat, embedText, type ChatMessage } from './connecty.llm';

const MIN_CONFIDENCE = 0.7;

export type FactOp = {
  op: 'add' | 'update' | 'delete';
  key: string;
  value?: string;
  category?: ConnectyFactCategory;
  confidence: number;
  importance?: number;
};

function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function parseOps(raw: string): FactOp[] {
  const text = raw.trim();
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: FactOp[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const op = rec.op;
      if (op !== 'add' && op !== 'update' && op !== 'delete') continue;
      if (typeof rec.key !== 'string' || !rec.key.trim()) continue;
      const confidence = typeof rec.confidence === 'number' ? rec.confidence : Number(rec.confidence);
      if (!Number.isFinite(confidence)) continue;
      let category: ConnectyFactCategory = 'other';
      if (typeof rec.category === 'string' && (CONNECTY_FACT_CATEGORIES as readonly string[]).includes(rec.category)) {
        category = rec.category as ConnectyFactCategory;
      }
      out.push({
        op,
        key: normalizeKey(rec.key),
        value: typeof rec.value === 'string' ? rec.value.trim() : undefined,
        category,
        confidence,
        importance:
          typeof rec.importance === 'number' && rec.importance >= 1 && rec.importance <= 5
            ? Math.round(rec.importance)
            : 3
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function extractAndApplyFacts(opts: {
  userId: string;
  recentTranscript: string;
  sourceMessageId?: string;
}): Promise<number> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You extract durable personal facts about ONE user from a friend chat.
Return ONLY a JSON array. No markdown.
Each item: {"op":"add"|"update"|"delete","key":"snake_case","value":"string","category":"identity|preference|relationship|goal|event|emotion|other","confidence":0-1,"importance":1-5}
Rules:
- Only facts clearly stated by the user about themselves.
- Use delete when they correct/retract (e.g. dog was Max, now Bruno → delete/update dog).
- No other people's private identity as facts.
- If nothing durable, return [].`
    },
    {
      role: 'user',
      content: opts.recentTranscript.slice(0, 6000)
    }
  ];

  const { text } = await connectyChat(messages, { maxTokens: 500 });
  if (text.includes("brain's spinning")) return 0;

  const ops = parseOps(text).filter((o) => o.confidence >= MIN_CONFIDENCE);
  if (!ops.length) return 0;

  const uid = new Types.ObjectId(opts.userId);
  let applied = 0;

  for (const op of ops) {
    if (op.op === 'delete') {
      const res = await ConnectyMemoryFactModel.deleteOne({ userId: uid, key: op.key });
      if (res.deletedCount) applied += 1;
      continue;
    }
    if (!op.value) continue;
    await ConnectyMemoryFactModel.findOneAndUpdate(
      { userId: uid, key: op.key },
      {
        $set: {
          value: op.value.slice(0, 500),
          category: op.category || 'other',
          importance: op.importance ?? 3,
          confidence: op.confidence,
          lastReinforcedAt: new Date(),
          sourceMessageId: opts.sourceMessageId
            ? new Types.ObjectId(opts.sourceMessageId)
            : null,
          evidence: op.value.slice(0, 200)
        },
        $setOnInsert: { userId: uid, key: op.key }
      },
      { upsert: true }
    );
    applied += 1;

    const sentence = `${op.key.replace(/_/g, ' ')}: ${op.value}`;
    const embedding = await embedText(sentence);
    await ConnectyMemoryChunkModel.create({
      userId: uid,
      text: sentence.slice(0, 1000),
      embedding,
      kind: 'fact',
      sourceMessageIds: opts.sourceMessageId ? [new Types.ObjectId(opts.sourceMessageId)] : []
    });
  }

  // Cap facts per user quietly
  const count = await ConnectyMemoryFactModel.countDocuments({ userId: uid });
  if (count > 200) {
    const oldest = await ConnectyMemoryFactModel.find({ userId: uid })
      .sort({ importance: 1, lastReinforcedAt: 1 })
      .limit(count - 200)
      .select('_id')
      .lean();
    if (oldest.length) {
      await ConnectyMemoryFactModel.deleteMany({ _id: { $in: oldest.map((o) => o._id) } });
    }
  }

  return applied;
}
