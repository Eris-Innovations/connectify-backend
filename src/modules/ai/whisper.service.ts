import axios from 'axios';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { getR2Client, objectKeyFromStoredUrl } from '../../lib/r2';
import { TranscriptModel } from './transcript.model';
import { hasActiveConsent } from '../compliance/consent.service';
import { CONSENT_PURPOSES } from '../compliance/consent.constants';
import { ConversationModel } from '../messages/conversation.model';
import { CallModel } from '../calls/call.model';
import { emitToUser } from '../../sockets/io';

async function fetchAudioBuffer(mediaUrl: string): Promise<{ buffer: Buffer; filename: string; mime: string }> {
  const key = objectKeyFromStoredUrl(mediaUrl);
  const client = getR2Client();
  if (key && client && env.R2_BUCKET) {
    try {
      const out = await client.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
      const body = out.Body;
      if (!body) throw new Error('empty R2 body');
      const chunks: Buffer[] = [];
      const stream = body as NodeJS.ReadableStream;
      for await (const chunk of stream) {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else if (typeof chunk === 'string') {
          chunks.push(Buffer.from(chunk, 'binary'));
        } else {
          chunks.push(Buffer.from(new Uint8Array(chunk as ArrayBufferLike)));
        }
      }
      const buffer = Buffer.concat(chunks);
      const ext = /\.(m4a|aac|mp3|webm|ogg|wav|mp4|3gp)(\?|$)/i.exec(mediaUrl)?.[1]?.toLowerCase() ?? 'm4a';
      const mime = out.ContentType?.trim() || (ext === 'webm' ? 'audio/webm' : ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4');
      return { buffer, filename: `audio.${ext}`, mime };
    } catch (e) {
      console.warn('[whisper] R2 fetch failed, falling back to HTTP', e);
    }
  }

  const res = await axios.get<ArrayBuffer>(mediaUrl, {
    responseType: 'arraybuffer',
    timeout: 120_000,
    maxContentLength: 25 * 1024 * 1024,
    validateStatus: (s) => s >= 200 && s < 400
  });
  const buffer = Buffer.from(res.data);
  const ct = String(res.headers['content-type'] || 'audio/mp4').split(';')[0].trim();
  const ext = /\.(m4a|aac|mp3|webm|ogg|wav|mp4|3gp)(\?|$)/i.exec(mediaUrl)?.[1]?.toLowerCase() ?? 'm4a';
  return { buffer, filename: `audio.${ext}`, mime: ct || 'audio/mp4' };
}

async function transcribeWithOpenAI(buffer: Buffer, filename: string, mime: string): Promise<string> {
  const key = env.OPENAI_API_KEY;
  if (!key) return '';

  const model = env.OPENAI_WHISPER_MODEL || 'whisper-1';
  const form = new FormData();
  form.append('model', model);
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mime || 'application/octet-stream' }), filename);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`
    },
    body: form
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Whisper HTTP ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = (await res.json()) as { text?: string };
  return typeof data.text === 'string' ? data.text : '';
}

async function notifyVoiceMessageTranscript(input: {
  conversationId: string;
  messageId: string;
  transcription: string;
}): Promise<void> {
  const conv = await ConversationModel.findById(input.conversationId).select('participants').lean();
  if (!conv?.participants?.length) return;

  const payload = {
    conversationId: input.conversationId,
    messageId: input.messageId,
    transcription: input.transcription
  };

  for (const participant of conv.participants) {
    emitToUser(String(participant.userId), 'message:transcript', payload);
  }
}

async function notifyCallTranscript(input: {
  callSessionId: string;
  transcription: string;
  callerId: string;
  receiverId: string;
}): Promise<void> {
  const payload = {
    callSessionId: input.callSessionId,
    transcription: input.transcription
  };
  emitToUser(input.callerId, 'call:transcript', payload);
  emitToUser(input.receiverId, 'call:transcript', payload);
}

type TranscriptionJob = {
  userId: string;
  mediaUrl: string;
  kind: 'voice_message' | 'call';
  consentPurpose: string;
  conversationId?: string;
  messageId?: string;
  callSessionId?: string;
};

async function runTranscriptionJob(input: TranscriptionJob): Promise<void> {
  if (!env.OPENAI_API_KEY) return;

  const consented = await hasActiveConsent(input.userId, input.consentPurpose);
  if (!consented) {
    console.info('[whisper] skipped — no active consent', {
      userId: input.userId,
      kind: input.kind,
      purpose: input.consentPurpose
    });
    return;
  }

  const { buffer, filename, mime } = await fetchAudioBuffer(input.mediaUrl);
  const raw = await transcribeWithOpenAI(buffer, filename, mime);
  const text = raw.trim();
  if (!text) {
    console.info('[whisper] empty transcript, skipping save', { kind: input.kind, messageId: input.messageId, callSessionId: input.callSessionId });
    return;
  }

  const doc: Record<string, unknown> = {
    userId: new Types.ObjectId(input.userId),
    kind: input.kind,
    mediaUrl: input.mediaUrl.slice(0, 2000),
    rawText: text,
    language: 'auto',
    source: 'whisper',
    whisperModel: env.OPENAI_WHISPER_MODEL
  };

  if (input.conversationId) doc.conversationId = new Types.ObjectId(input.conversationId);
  if (input.messageId) doc.messageId = new Types.ObjectId(input.messageId);
  if (input.callSessionId) doc.callSessionId = new Types.ObjectId(input.callSessionId);

  await TranscriptModel.create(doc);
  console.info('[whisper] saved transcript', { kind: input.kind, messageId: input.messageId, callSessionId: input.callSessionId });

  if (input.kind === 'voice_message' && input.conversationId && input.messageId) {
    await notifyVoiceMessageTranscript({
      conversationId: input.conversationId,
      messageId: input.messageId,
      transcription: text
    });
  }

  if (input.kind === 'call' && input.callSessionId) {
    const call = await CallModel.findById(input.callSessionId).select('callerId receiverId').lean();
    if (call) {
      await notifyCallTranscript({
        callSessionId: input.callSessionId,
        transcription: text,
        callerId: String(call.callerId),
        receiverId: String(call.receiverId)
      });
    }
  }
}

function scheduleTranscription(input: TranscriptionJob): void {
  void (async () => {
    try {
      await runTranscriptionJob(input);
    } catch (e: unknown) {
      const code = e && typeof e === 'object' && 'code' in e ? Number((e as { code: unknown }).code) : undefined;
      if (code === 11000) {
        console.info('[whisper] duplicate transcript skipped', {
          messageId: input.messageId,
          callSessionId: input.callSessionId
        });
        return;
      }
      console.error('[whisper] transcription failed', { kind: input.kind, error: e });
    }
  })();
}

/**
 * Runs OpenAI Whisper on a chat voice attachment when the sender has granted voice transcription consent.
 * Fire-and-forget from the socket layer; errors are logged only.
 */
export function scheduleVoiceMessageTranscription(input: {
  userId: string;
  mediaUrl: string;
  conversationId: string;
  messageId: string;
}): void {
  scheduleTranscription({
    userId: input.userId,
    mediaUrl: input.mediaUrl,
    kind: 'voice_message',
    consentPurpose: CONSENT_PURPOSES.VOICE_TRANSCRIPTION,
    conversationId: input.conversationId,
    messageId: input.messageId
  });
}

/**
 * Runs OpenAI Whisper on a stored call recording when the uploader has granted call transcription consent.
 */
export function scheduleCallTranscription(input: {
  userId: string;
  mediaUrl: string;
  callSessionId: string;
}): void {
  scheduleTranscription({
    userId: input.userId,
    mediaUrl: input.mediaUrl,
    kind: 'call',
    consentPurpose: CONSENT_PURPOSES.CALL_TRANSCRIPTION,
    callSessionId: input.callSessionId
  });
}
