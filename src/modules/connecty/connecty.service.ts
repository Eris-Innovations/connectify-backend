import { Types } from 'mongoose';
import { UserModel } from '../users/user.model';
import { ConnectyThreadModel } from './connecty-thread.model';
import { ConnectyMessageModel } from './connecty-message.model';
import { ConnectyMemoryChunkModel } from './connecty-chunk.model';
import { ConnectyMemoryFactModel } from './connecty-memory.model';
import { buildContextPack } from './connecty.context-pack';
import { buildConnectySystemPrompt, stripEmotionPrefix, CONNECTY_WELCOME } from './connecty.persona';
import {
  connectyChat,
  connectyChatStreaming,
  embedText,
  type ChatMessage,
  hasAnyConnectyLlm
} from './connecty.llm';
import { extractAndApplyFacts } from './fact-extractor';
import { maybeRefreshRunningSummary } from './connecty.summarizer';

function dtoMessage(doc: {
  _id: Types.ObjectId;
  role: string;
  text: string;
  emotion?: string | null;
  createdAt?: Date;
  clientId?: string | null;
}) {
  return {
    id: String(doc._id),
    role: doc.role,
    text: doc.text,
    emotion: doc.emotion ?? null,
    createdAt: doc.createdAt ?? new Date(),
    clientId: doc.clientId ?? null
  };
}

const FACT_EXTRACT_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch(() => {
        clearTimeout(t);
        resolve(null);
      });
  });
}

export async function ensureConnectyThread(userId: string) {
  const uid = new Types.ObjectId(userId);
  let thread = await ConnectyThreadModel.findOne({ userId: uid });
  if (thread) return thread;

  thread = await ConnectyThreadModel.create({
    userId: uid,
    runningSummary: '',
    messageCount: 0,
    lastMessagePreview: CONNECTY_WELCOME,
    lastMessageAt: new Date()
  });

  await ConnectyMessageModel.create({
    userId: uid,
    threadId: thread._id,
    role: 'assistant',
    text: CONNECTY_WELCOME,
    emotion: 'warm'
  });
  thread.messageCount = 1;
  await thread.save();
  return thread;
}

export async function getConnectyProfile(userId: string) {
  const thread = await ensureConnectyThread(userId);
  const uid = new Types.ObjectId(userId);
  const factCount = await ConnectyMemoryFactModel.countDocuments({ userId: uid });
  return {
    name: 'Connecty',
    threadId: String(thread._id),
    messageCount: thread.messageCount,
    factCount,
    lastMessagePreview: thread.lastMessagePreview,
    lastMessageAt: thread.lastMessageAt,
    lastEmotion: thread.lastEmotion
  };
}

export async function listConnectyMessages(userId: string, opts?: { limit?: number; before?: string }) {
  const thread = await ensureConnectyThread(userId);
  const uid = new Types.ObjectId(userId);
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);

  const filter: Record<string, unknown> = { userId: uid, threadId: thread._id };
  if (opts?.before && Types.ObjectId.isValid(opts.before)) {
    const cursor = await ConnectyMessageModel.findOne({
      _id: opts.before,
      userId: uid
    })
      .select('createdAt')
      .lean();
    if (cursor?.createdAt) {
      filter.createdAt = { $lt: cursor.createdAt };
    }
  }

  const docs = await ConnectyMessageModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return {
    threadId: String(thread._id),
    messages: docs.reverse().map(dtoMessage)
  };
}

async function findIdempotentReply(userId: string, clientId: string) {
  const uid = new Types.ObjectId(userId);
  const userMsg = await ConnectyMessageModel.findOne({
    userId: uid,
    clientId,
    role: 'user'
  }).lean();
  if (!userMsg) return null;
  const assistantMsg = await ConnectyMessageModel.findOne({
    userId: uid,
    replyToMessageId: userMsg._id,
    role: 'assistant'
  }).lean();
  if (!assistantMsg) return null;
  return {
    userMessage: dtoMessage(userMsg),
    assistantMessage: dtoMessage(assistantMsg),
    mock: false,
    provider: 'none' as const,
    idempotent: true
  };
}

async function buildChatMessages(userId: string, thread: Awaited<ReturnType<typeof ensureConnectyThread>>, clean: string) {
  const user = await UserModel.findById(userId).select('name').lean();
  const pack = await buildContextPack({
    userId,
    thread,
    latestUserText: clean
  });

  const system = buildConnectySystemPrompt({
    factsBlock: pack.factsBlock,
    summaryBlock: pack.summaryBlock,
    ragBlock: pack.ragBlock,
    userDisplayName: user?.name
  });

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: system },
    ...pack.recentMessages.map((m) => ({
      role: m.role === 'system' ? ('user' as const) : (m.role as 'user' | 'assistant'),
      content: m.content
    }))
  ];

  if (!chatMessages.some((m) => m.role === 'user' && m.content === clean)) {
    chatMessages.push({ role: 'user', content: clean });
  }
  return chatMessages;
}

async function runPostProcess(opts: {
  userId: string;
  uid: Types.ObjectId;
  clean: string;
  replyText: string;
  userMsgId: Types.ObjectId;
  assistantMsgId: Types.ObjectId;
  warmFacts: boolean;
}) {
  const recentPair = `user: ${opts.clean}\nassistant: ${opts.replyText}`;
  let extractedWarm = false;
  if (opts.warmFacts) {
    const applied = await withTimeout(
      extractAndApplyFacts({
        userId: opts.userId,
        recentTranscript: recentPair,
        sourceMessageId: String(opts.userMsgId)
      }),
      FACT_EXTRACT_TIMEOUT_MS
    );
    extractedWarm = applied != null;
    if (applied != null && process.env.NODE_ENV !== 'production') {
      console.log(`[connecty] fact extract applied=${applied}`);
    }
  }

  void (async () => {
    try {
      if (!extractedWarm) {
        const applied = await extractAndApplyFacts({
          userId: opts.userId,
          recentTranscript: recentPair,
          sourceMessageId: String(opts.userMsgId)
        });
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[connecty] fact extract cold applied=${applied}`);
        }
      }
      const turnEmbedding = await embedText(`user: ${opts.clean}\nconnecty: ${opts.replyText}`);
      await ConnectyMemoryChunkModel.create({
        userId: opts.uid,
        text: `user: ${opts.clean}\nconnecty: ${opts.replyText}`.slice(0, 1200),
        embedding: turnEmbedding,
        kind: 'turn',
        sourceMessageIds: [opts.userMsgId, opts.assistantMsgId]
      });
      const fresh = await ConnectyThreadModel.findOne({ userId: opts.uid });
      if (fresh) await maybeRefreshRunningSummary({ userId: opts.userId, thread: fresh });
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[connecty] post-process failed', err instanceof Error ? err.message : err);
      }
    }
  })();
}

export async function sendConnectyMessage(
  userId: string,
  text: string,
  opts?: { clientId?: string }
) {
  const clean = text.trim();
  if (!clean) throw new Error('EMPTY_TEXT');
  if (clean.length > 4000) throw new Error('TEXT_TOO_LONG');

  const clientId =
    typeof opts?.clientId === 'string' && opts.clientId.trim() ? opts.clientId.trim().slice(0, 80) : null;

  if (clientId) {
    const existing = await findIdempotentReply(userId, clientId);
    if (existing) return existing;
  }

  const thread = await ensureConnectyThread(userId);
  const uid = new Types.ObjectId(userId);

  let userMsg;
  try {
    userMsg = await ConnectyMessageModel.create({
      userId: uid,
      threadId: thread._id,
      role: 'user',
      text: clean,
      clientId
    });
  } catch (err: unknown) {
    // unique clientId race
    if (clientId && err && typeof err === 'object' && 'code' in err && (err as { code?: number }).code === 11000) {
      const existing = await findIdempotentReply(userId, clientId);
      if (existing) return existing;
    }
    throw err;
  }

  thread.messageCount += 1;
  thread.lastMessagePreview = clean.slice(0, 200);
  thread.lastMessageAt = new Date();
  await thread.save();

  if (!hasAnyConnectyLlm()) {
    const fallback =
      "hey — my brain's not plugged in yet on the server (add a free Groq or Gemini key). still your friend though: tell me more?";
    const assistantMsg = await ConnectyMessageModel.create({
      userId: uid,
      threadId: thread._id,
      role: 'assistant',
      text: fallback,
      emotion: 'playful',
      replyToMessageId: userMsg._id
    });
    thread.messageCount += 1;
    thread.lastMessagePreview = fallback.slice(0, 200);
    thread.lastMessageAt = new Date();
    await thread.save();
    return {
      userMessage: dtoMessage(userMsg),
      assistantMessage: dtoMessage(assistantMsg),
      mock: true,
      provider: 'none' as const,
      latencyMs: 0
    };
  }

  const chatMessages = await buildChatMessages(userId, thread, clean);
  const result = await connectyChat(chatMessages, { maxTokens: 700 });
  const { text: replyText, emotion } = stripEmotionPrefix(result.text);

  const assistantMsg = await ConnectyMessageModel.create({
    userId: uid,
    threadId: thread._id,
    role: 'assistant',
    text: replyText,
    emotion: emotion ?? null,
    replyToMessageId: userMsg._id
  });

  thread.messageCount += 1;
  thread.lastMessagePreview = replyText.slice(0, 200);
  thread.lastMessageAt = new Date();
  thread.lastEmotion = emotion ?? thread.lastEmotion ?? null;
  await thread.save();

  await runPostProcess({
    userId,
    uid,
    clean,
    replyText,
    userMsgId: userMsg._id,
    assistantMsgId: assistantMsg._id,
    warmFacts: true
  });

  return {
    userMessage: dtoMessage(userMsg),
    assistantMessage: dtoMessage(assistantMsg),
    mock: result.provider === 'none',
    provider: result.provider,
    errorDetail: result.errorDetail,
    latencyMs: result.latencyMs
  };
}

export type StreamHandlers = {
  onUserAck: (userMessage: ReturnType<typeof dtoMessage>) => void;
  onToken: (delta: string) => void;
  onDone: (payload: {
    assistantMessage: ReturnType<typeof dtoMessage>;
    provider: string;
    latencyMs?: number;
    mock?: boolean;
    errorDetail?: string;
  }) => void;
  onError: (message: string) => void;
};

export async function sendConnectyMessageStream(
  userId: string,
  text: string,
  handlers: StreamHandlers,
  opts?: { clientId?: string }
) {
  const clean = text.trim();
  if (!clean) {
    handlers.onError('text is required');
    return;
  }
  if (clean.length > 4000) {
    handlers.onError('text too long');
    return;
  }

  const clientId =
    typeof opts?.clientId === 'string' && opts.clientId.trim() ? opts.clientId.trim().slice(0, 80) : null;

  if (clientId) {
    const existing = await findIdempotentReply(userId, clientId);
    if (existing) {
      handlers.onUserAck(existing.userMessage);
      handlers.onToken(existing.assistantMessage.text);
      handlers.onDone({
        assistantMessage: existing.assistantMessage,
        provider: 'none',
        mock: false,
        latencyMs: 0
      });
      return;
    }
  }

  const thread = await ensureConnectyThread(userId);
  const uid = new Types.ObjectId(userId);

  let userMsg;
  try {
    userMsg = await ConnectyMessageModel.create({
      userId: uid,
      threadId: thread._id,
      role: 'user',
      text: clean,
      clientId
    });
  } catch (err: unknown) {
    if (clientId && err && typeof err === 'object' && 'code' in err && (err as { code?: number }).code === 11000) {
      const existing = await findIdempotentReply(userId, clientId);
      if (existing) {
        handlers.onUserAck(existing.userMessage);
        handlers.onToken(existing.assistantMessage.text);
        handlers.onDone({
          assistantMessage: existing.assistantMessage,
          provider: 'none',
          latencyMs: 0
        });
        return;
      }
    }
    handlers.onError('Failed to save message');
    return;
  }

  thread.messageCount += 1;
  thread.lastMessagePreview = clean.slice(0, 200);
  thread.lastMessageAt = new Date();
  await thread.save();
  handlers.onUserAck(dtoMessage(userMsg));

  if (!hasAnyConnectyLlm()) {
    const fallback =
      "hey — my brain's not plugged in yet on the server (add a free Groq or Gemini key). still your friend though: tell me more?";
    handlers.onToken(fallback);
    const assistantMsg = await ConnectyMessageModel.create({
      userId: uid,
      threadId: thread._id,
      role: 'assistant',
      text: fallback,
      emotion: 'playful',
      replyToMessageId: userMsg._id
    });
    thread.messageCount += 1;
    thread.lastMessagePreview = fallback.slice(0, 200);
    thread.lastMessageAt = new Date();
    await thread.save();
    handlers.onDone({
      assistantMessage: dtoMessage(assistantMsg),
      provider: 'none',
      mock: true,
      latencyMs: 0
    });
    return;
  }

  try {
    const chatMessages = await buildChatMessages(userId, thread, clean);
    const result = await connectyChatStreaming(chatMessages, {
      maxTokens: 700,
      onDelta: handlers.onToken
    });
    const { text: replyText, emotion } = stripEmotionPrefix(result.text);

    const assistantMsg = await ConnectyMessageModel.create({
      userId: uid,
      threadId: thread._id,
      role: 'assistant',
      text: replyText,
      emotion: emotion ?? null,
      replyToMessageId: userMsg._id
    });

    thread.messageCount += 1;
    thread.lastMessagePreview = replyText.slice(0, 200);
    thread.lastMessageAt = new Date();
    thread.lastEmotion = emotion ?? thread.lastEmotion ?? null;
    await thread.save();

    await runPostProcess({
      userId,
      uid,
      clean,
      replyText,
      userMsgId: userMsg._id,
      assistantMsgId: assistantMsg._id,
      warmFacts: true
    });

    handlers.onDone({
      assistantMessage: dtoMessage(assistantMsg),
      provider: result.provider,
      mock: result.provider === 'none',
      errorDetail: result.errorDetail,
      latencyMs: result.latencyMs
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'stream failed';
    handlers.onError(msg);
  }
}

export async function clearConnectyMemory(userId: string, opts?: { wipeMessages?: boolean }) {
  const uid = new Types.ObjectId(userId);
  await Promise.all([
    ConnectyMemoryFactModel.deleteMany({ userId: uid }),
    ConnectyMemoryChunkModel.deleteMany({ userId: uid })
  ]);

  const thread = await ConnectyThreadModel.findOne({ userId: uid });
  if (thread) {
    thread.runningSummary = '';
    thread.summaryUpToMessageId = null;
    thread.topicTags = [];
    if (opts?.wipeMessages) {
      await ConnectyMessageModel.deleteMany({ userId: uid, threadId: thread._id });
      thread.messageCount = 0;
      await ConnectyMessageModel.create({
        userId: uid,
        threadId: thread._id,
        role: 'assistant',
        text: CONNECTY_WELCOME,
        emotion: 'warm'
      });
      thread.messageCount = 1;
      thread.lastMessagePreview = CONNECTY_WELCOME;
      thread.lastMessageAt = new Date();
    }
    await thread.save();
  }

  return { cleared: true };
}

export async function pinConnectyMemory(userId: string, key: string, value: string) {
  const uid = new Types.ObjectId(userId);
  const normKey = key.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 80);
  const val = value.trim().slice(0, 500);
  if (!normKey || !val) throw new Error('INVALID_PIN');

  await ConnectyMemoryFactModel.findOneAndUpdate(
    { userId: uid, key: normKey },
    {
      $set: {
        value: val,
        category: 'other',
        importance: 5,
        confidence: 1,
        lastReinforcedAt: new Date(),
        evidence: val
      },
      $setOnInsert: { userId: uid, key: normKey }
    },
    { upsert: true }
  );

  const embedding = await embedText(`${normKey}: ${val}`);
  await ConnectyMemoryChunkModel.create({
    userId: uid,
    text: `${normKey.replace(/_/g, ' ')}: ${val}`,
    embedding,
    kind: 'fact',
    sourceMessageIds: []
  });

  return { pinned: true, key: normKey, value: val };
}

export async function unpinConnectyMemory(userId: string, key: string) {
  const uid = new Types.ObjectId(userId);
  const normKey = key.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 80);
  if (!normKey) throw new Error('INVALID_KEY');
  const res = await ConnectyMemoryFactModel.deleteOne({ userId: uid, key: normKey });
  return { unpinned: res.deletedCount > 0, key: normKey };
}

/** Pin a free-text memory from a long-press bubble (auto key). */
export async function pinConnectyText(userId: string, text: string) {
  const val = text.trim().slice(0, 500);
  if (!val) throw new Error('INVALID_PIN');
  const key = `note_${Date.now().toString(36)}`;
  return pinConnectyMemory(userId, key, val);
}
