import axios from 'axios';
import { env } from '../../config/env';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type LlmProvider = 'openai' | 'groq' | 'gemini' | 'ollama' | 'none';

export type LlmChatResult = {
  text: string;
  provider: LlmProvider;
  errorDetail?: string;
  latencyMs?: number;
};

const SOFT_FAILURE =
  "ugh my brain's spinning for a sec 😵 hit me again in a moment, I'm still here for you.";

/** Circuit breaker: after auth/hard failures, skip provider for a short window. */
const circuitOpenUntil = new Map<string, number>();
const CIRCUIT_MS = 60_000;

function isCircuitOpen(provider: string): boolean {
  const until = circuitOpenUntil.get(provider) ?? 0;
  return Date.now() < until;
}

function tripCircuit(provider: string, reason: string) {
  circuitOpenUntil.set(provider, Date.now() + CIRCUIT_MS);
  console.warn(`[connecty] circuit open for ${provider} (${CIRCUIT_MS}ms): ${reason.slice(0, 200)}`);
}

/** Test helper */
export function _resetConnectyCircuits() {
  circuitOpenUntil.clear();
}

function formatAxiosError(err: unknown): string {
  if (!axios.isAxiosError(err)) {
    return err instanceof Error ? err.message : String(err);
  }
  const status = err.response?.status;
  const data = err.response?.data;
  let body = '';
  if (typeof data === 'string') body = data.slice(0, 400);
  else if (data && typeof data === 'object') {
    try {
      body = JSON.stringify(data).slice(0, 400);
    } catch {
      body = '';
    }
  }
  return `HTTP ${status ?? 'network'} ${err.message}${body ? ` body=${body}` : ''}`;
}

function shouldTripCircuit(detail: string): boolean {
  return /HTTP_401|HTTP_403|OPENAI_HTTP_401|OPENAI_HTTP_403|GROQ_HTTP_401|GROQ_HTTP_403|GEMINI_HTTP_401|GEMINI_HTTP_403|invalid.?api.?key/i.test(
    detail
  );
}

/** OpenAI-compatible APIs reject empty content and non-standard roles. */
export function sanitizeMessagesForGroq(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content.trim() : '';
    if (!content) continue;
    const role: ChatMessage['role'] =
      m.role === 'system' || m.role === 'assistant' || m.role === 'user' ? m.role : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n${content}`;
    } else {
      out.push({ role, content });
    }
  }
  if (!out.length) {
    out.push({ role: 'user', content: 'hi' });
  }
  if (out[out.length - 1]!.role === 'assistant') {
    out.push({ role: 'user', content: 'continue' });
  }
  return out;
}

type OpenAiCompatibleChatOpts = {
  provider: 'openai' | 'groq';
  url: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  stream?: false;
};

async function chatOpenAiCompatible(opts: OpenAiCompatibleChatOpts): Promise<string> {
  const tag = opts.provider.toUpperCase();
  if (!opts.apiKey.trim()) throw new Error(`${tag}_API_KEY_MISSING`);
  if (isCircuitOpen(opts.provider)) throw new Error(`${tag}_CIRCUIT_OPEN`);

  const safeMessages = sanitizeMessagesForGroq(opts.messages);

  try {
    const response = await axios.post(
      opts.url,
      {
        model: opts.model,
        messages: safeMessages,
        max_tokens: opts.maxTokens,
        temperature: 0.75,
        stream: false
      },
      {
        headers: {
          Authorization: `Bearer ${opts.apiKey.trim()}`,
          'Content-Type': 'application/json'
        },
        timeout: 60_000,
        validateStatus: () => true
      }
    );

    if (response.status < 200 || response.status >= 300) {
      const errBody =
        typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data ?? {}).slice(0, 500);
      const msg = `${tag}_HTTP_${response.status}: ${errBody}`;
      if (shouldTripCircuit(msg)) tripCircuit(opts.provider, msg);
      throw new Error(msg);
    }

    const text = response.data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error(`${tag}_EMPTY_RESPONSE: ${JSON.stringify(response.data).slice(0, 300)}`);
    }
    return text.trim();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(`${tag}_`)) throw err;
    throw new Error(`${tag}_FAILED: ${formatAxiosError(err)}`);
  }
}

async function chatOpenAi(messages: ChatMessage[], maxTokens: number): Promise<string> {
  return chatOpenAiCompatible({
    provider: 'openai',
    url: 'https://api.openai.com/v1/chat/completions',
    apiKey: env.OPENAI_API_KEY || '',
    model: (env.OPENAI_CHAT_MODEL || 'gpt-4o-mini').trim(),
    messages,
    maxTokens
  });
}

async function chatGroq(messages: ChatMessage[], maxTokens: number): Promise<string> {
  return chatOpenAiCompatible({
    provider: 'groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: env.GROQ_API_KEY || '',
    model: (env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim(),
    messages,
    maxTokens
  });
}

/**
 * Stream OpenAI-compatible chat tokens; calls onDelta for each piece. Returns full text.
 */
async function streamChatOpenAiCompatible(
  provider: 'openai' | 'groq',
  url: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  onDelta: (delta: string) => void
): Promise<string> {
  const tag = provider.toUpperCase();
  if (!apiKey.trim()) throw new Error(`${tag}_API_KEY_MISSING`);
  if (isCircuitOpen(provider)) throw new Error(`${tag}_CIRCUIT_OPEN`);

  const safeMessages = sanitizeMessagesForGroq(messages);

  const response = await axios.post(
    url,
    {
      model,
      messages: safeMessages,
      max_tokens: maxTokens,
      temperature: 0.75,
      stream: true
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      timeout: 90_000,
      responseType: 'stream',
      validateStatus: () => true
    }
  );

  if (response.status < 200 || response.status >= 300) {
    let errBody = '';
    try {
      const chunks: Buffer[] = [];
      for await (const c of response.data as AsyncIterable<Buffer>) {
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      }
      errBody = Buffer.concat(chunks).toString('utf8').slice(0, 500);
    } catch {
      errBody = String(response.statusText || '');
    }
    const msg = `${tag}_HTTP_${response.status}: ${errBody}`;
    if (shouldTripCircuit(msg)) tripCircuit(provider, msg);
    throw new Error(msg);
  }

  let full = '';
  let buffer = '';
  const stream = response.data as NodeJS.ReadableStream;

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer | string) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            full += delta;
            onDelta(delta);
          }
        } catch {
          // ignore partial JSON
        }
      }
    });
    stream.on('end', () => resolve());
    stream.on('error', (e) => reject(e));
  });

  if (!full.trim()) throw new Error(`${tag}_EMPTY_STREAM`);
  return full.trim();
}

export async function streamChatOpenAi(
  messages: ChatMessage[],
  maxTokens: number,
  onDelta: (delta: string) => void
): Promise<string> {
  return streamChatOpenAiCompatible(
    'openai',
    'https://api.openai.com/v1/chat/completions',
    env.OPENAI_API_KEY || '',
    (env.OPENAI_CHAT_MODEL || 'gpt-4o-mini').trim(),
    messages,
    maxTokens,
    onDelta
  );
}

/**
 * Stream Groq tokens; calls onDelta for each piece. Returns full text.
 */
export async function streamChatGroq(
  messages: ChatMessage[],
  maxTokens: number,
  onDelta: (delta: string) => void
): Promise<string> {
  return streamChatOpenAiCompatible(
    'groq',
    'https://api.groq.com/openai/v1/chat/completions',
    env.GROQ_API_KEY || '',
    (env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim(),
    messages,
    maxTokens,
    onDelta
  );
}

async function chatOllama(messages: ChatMessage[], maxTokens: number): Promise<string> {
  if (isCircuitOpen('ollama')) throw new Error('OLLAMA_CIRCUIT_OPEN');
  const base = (env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const response = await axios.post(
    `${base}/api/chat`,
    {
      model: env.OLLAMA_MODEL,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      options: { num_predict: maxTokens, temperature: 0.75 }
    },
    { timeout: 90_000 }
  );
  const text = response.data?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('OLLAMA_EMPTY_RESPONSE');
  return text.trim();
}

async function chatGemini(messages: ChatMessage[], maxTokens: number): Promise<string> {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY_MISSING');
  if (isCircuitOpen('gemini')) throw new Error('GEMINI_CIRCUIT_OPEN');

  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const nonSystem = messages.filter((m) => m.role !== 'system');
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  for (const m of nonSystem) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts[0]!.text += `\n${m.content}`;
    } else {
      contents.push({ role, parts: [{ text: m.content }] });
    }
  }
  if (!contents.length) {
    contents.push({ role: 'user', parts: [{ text: 'hi' }] });
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.75 }
  };
  if (systemParts.length) {
    body.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`;
  const response = await axios.post(url, body, {
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': env.GEMINI_API_KEY
    },
    timeout: 60_000,
    validateStatus: () => true
  });

  if (response.status < 200 || response.status >= 300) {
    const msg = `GEMINI_HTTP_${response.status}: ${JSON.stringify(response.data).slice(0, 400)}`;
    if (shouldTripCircuit(msg)) tripCircuit('gemini', msg);
    throw new Error(msg);
  }

  const parts = response.data?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((p: { text?: string }) => (typeof p?.text === 'string' ? p.text : '')).join('')
    : '';
  if (!text.trim()) throw new Error('GEMINI_EMPTY_RESPONSE');
  return text.trim();
}

export async function connectyChat(
  messages: ChatMessage[],
  opts?: { maxTokens?: number }
): Promise<LlmChatResult> {
  const maxTokens = opts?.maxTokens ?? 700;
  const preferred = env.CONNECTY_LLM_PROVIDER;
  const started = Date.now();

  type Attempt = { provider: 'openai' | 'groq' | 'gemini' | 'ollama'; run: () => Promise<string> };
  const all: Attempt[] = [
    { provider: 'openai', run: () => chatOpenAi(messages, maxTokens) },
    { provider: 'groq', run: () => chatGroq(messages, maxTokens) },
    { provider: 'gemini', run: () => chatGemini(messages, maxTokens) },
    { provider: 'ollama', run: () => chatOllama(messages, maxTokens) }
  ];

  let order: Attempt[];
  if (preferred === 'openai') order = [all[0]!, all[1]!, all[2]!, all[3]!];
  else if (preferred === 'groq') order = [all[1]!, all[0]!, all[2]!, all[3]!];
  else if (preferred === 'gemini') order = [all[2]!, all[0]!, all[1]!, all[3]!];
  else if (preferred === 'ollama') order = [all[3]!, all[0]!, all[1]!, all[2]!];
  else order = all; // auto: openai → groq → gemini → ollama

  order = order.filter((a) => {
    if (a.provider === 'openai') return Boolean(env.OPENAI_API_KEY?.trim()) && !isCircuitOpen('openai');
    if (a.provider === 'groq') return Boolean(env.GROQ_API_KEY?.trim()) && !isCircuitOpen('groq');
    if (a.provider === 'gemini') return Boolean(env.GEMINI_API_KEY?.trim()) && !isCircuitOpen('gemini');
    if (a.provider === 'ollama') {
      return (preferred === 'ollama' || Boolean(env.OLLAMA_BASE_URL)) && !isCircuitOpen('ollama');
    }
    return false;
  });

  if (!order.length) {
    return {
      text: SOFT_FAILURE,
      provider: 'none',
      errorDetail: 'NO_PROVIDERS_CONFIGURED',
      latencyMs: Date.now() - started
    };
  }

  const failures: string[] = [];
  for (const attempt of order) {
    try {
      const text = await attempt.run();
      const latencyMs = Date.now() - started;
      console.log(`[connecty] LLM provider=${attempt.provider} latencyMs=${latencyMs}`);
      return { text, provider: attempt.provider, latencyMs };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      failures.push(`${attempt.provider}: ${detail}`);
      console.warn(`[connecty] ${attempt.provider} failed:`, detail.slice(0, 500));
    }
  }

  return {
    text: SOFT_FAILURE,
    provider: 'none',
    errorDetail: failures.join(' || ').slice(0, 800),
    latencyMs: Date.now() - started
  };
}

/**
 * Prefer OpenAI (then Groq) streaming; on failure fall back to non-stream full reply with synthetic token chunks.
 */
export async function connectyChatStreaming(
  messages: ChatMessage[],
  opts: { maxTokens?: number; onDelta: (delta: string) => void }
): Promise<LlmChatResult> {
  const maxTokens = opts.maxTokens ?? 700;
  const started = Date.now();
  const preferred = env.CONNECTY_LLM_PROVIDER;

  const tryOpenAiStream =
    Boolean(env.OPENAI_API_KEY?.trim()) &&
    !isCircuitOpen('openai') &&
    preferred !== 'groq' &&
    preferred !== 'gemini' &&
    preferred !== 'ollama';

  if (tryOpenAiStream) {
    try {
      const text = await streamChatOpenAi(messages, maxTokens, opts.onDelta);
      const latencyMs = Date.now() - started;
      console.log(`[connecty] LLM stream provider=openai latencyMs=${latencyMs}`);
      return { text, provider: 'openai', latencyMs };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.warn('[connecty] stream openai failed, falling back:', detail.slice(0, 400));
    }
  }

  const tryGroqStream =
    Boolean(env.GROQ_API_KEY?.trim()) &&
    !isCircuitOpen('groq') &&
    preferred !== 'openai' &&
    preferred !== 'gemini' &&
    preferred !== 'ollama';

  if (tryGroqStream || (preferred === 'groq' && Boolean(env.GROQ_API_KEY?.trim()) && !isCircuitOpen('groq'))) {
    try {
      const text = await streamChatGroq(messages, maxTokens, opts.onDelta);
      const latencyMs = Date.now() - started;
      console.log(`[connecty] LLM stream provider=groq latencyMs=${latencyMs}`);
      return { text, provider: 'groq', latencyMs };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.warn('[connecty] stream groq failed, falling back:', detail.slice(0, 400));
    }
  }

  // Fallback: full generate then optional chunk synthetic deltas
  const result = await connectyChat(messages, { maxTokens });
  if (result.text && result.provider !== 'none') {
    const chunkSize = 24;
    for (let i = 0; i < result.text.length; i += chunkSize) {
      opts.onDelta(result.text.slice(i, i + chunkSize));
    }
  }
  return result;
}

export async function probeLlmProviders(): Promise<{
  preferred: string;
  openai: { configured: boolean; ok: boolean; detail?: string; circuitOpen?: boolean };
  groq: { configured: boolean; ok: boolean; detail?: string; circuitOpen?: boolean };
  gemini: { configured: boolean; ok: boolean; detail?: string; circuitOpen?: boolean };
}> {
  const openaiConfigured = Boolean(env.OPENAI_API_KEY?.trim());
  const groqConfigured = Boolean(env.GROQ_API_KEY?.trim());
  const geminiConfigured = Boolean(env.GEMINI_API_KEY?.trim());
  const result = {
    preferred: env.CONNECTY_LLM_PROVIDER,
    openai: {
      configured: openaiConfigured,
      ok: false as boolean,
      detail: undefined as string | undefined,
      circuitOpen: isCircuitOpen('openai')
    },
    groq: {
      configured: groqConfigured,
      ok: false as boolean,
      detail: undefined as string | undefined,
      circuitOpen: isCircuitOpen('groq')
    },
    gemini: {
      configured: geminiConfigured,
      ok: false as boolean,
      detail: undefined as string | undefined,
      circuitOpen: isCircuitOpen('gemini')
    }
  };

  if (openaiConfigured && !result.openai.circuitOpen) {
    try {
      const text = await chatOpenAi([{ role: 'user', content: 'Reply with exactly: openai_ok' }], 16);
      result.openai.ok = text.length > 0;
      result.openai.detail = `ok len=${text.length} model=${env.OPENAI_CHAT_MODEL}`;
    } catch (err) {
      result.openai.detail = err instanceof Error ? err.message.slice(0, 300) : 'failed';
    }
  } else if (!openaiConfigured) {
    result.openai.detail = 'OPENAI_API_KEY not set';
  } else {
    result.openai.detail = 'circuit open';
  }

  if (groqConfigured && !result.groq.circuitOpen) {
    try {
      const text = await chatGroq([{ role: 'user', content: 'Reply with exactly: groq_ok' }], 16);
      result.groq.ok = text.length > 0;
      result.groq.detail = `ok len=${text.length}`;
    } catch (err) {
      result.groq.detail = err instanceof Error ? err.message.slice(0, 300) : 'failed';
    }
  } else if (!groqConfigured) {
    result.groq.detail = 'GROQ_API_KEY not set';
  } else {
    result.groq.detail = 'circuit open';
  }

  if (geminiConfigured && !result.gemini.circuitOpen) {
    try {
      const text = await chatGemini([{ role: 'user', content: 'Say hi in three short words' }], 32);
      result.gemini.ok = text.length > 0;
      result.gemini.detail = `ok len=${text.length}`;
    } catch (err) {
      result.gemini.detail = err instanceof Error ? err.message.slice(0, 300) : 'failed';
    }
  } else if (!geminiConfigured) {
    result.gemini.detail = 'GEMINI_API_KEY not set';
  } else {
    result.gemini.detail = 'circuit open';
  }

  return result;
}

export async function embedText(text: string): Promise<number[]> {
  const trimmed = text.trim().slice(0, 8000);
  if (!trimmed || !env.GEMINI_API_KEY) return [];

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_EMBEDDING_MODEL}:embedContent`;
    const response = await axios.post(
      url,
      {
        model: `models/${env.GEMINI_EMBEDDING_MODEL}`,
        content: { parts: [{ text: trimmed }] }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': env.GEMINI_API_KEY
        },
        timeout: 30_000
      }
    );
    const values = response.data?.embedding?.values;
    if (Array.isArray(values) && values.every((n: unknown) => typeof n === 'number')) {
      return values as number[];
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[connecty] embed failed', err instanceof Error ? err.message : err);
    }
  }
  return [];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function hasAnyConnectyLlm(): boolean {
  return Boolean(
    env.OPENAI_API_KEY?.trim() ||
      env.GROQ_API_KEY?.trim() ||
      env.GEMINI_API_KEY?.trim() ||
      env.OLLAMA_BASE_URL ||
      env.CONNECTY_LLM_PROVIDER === 'ollama'
  );
}
