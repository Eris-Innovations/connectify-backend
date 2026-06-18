import axios from 'axios';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { getR2Client, objectKeyFromStoredUrl } from '../../lib/r2';
import { TranscriptModel } from './transcript.model';

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

/**
 * Runs OpenAI Whisper on a chat voice attachment and stores a transcript for admin review.
 * Fire-and-forget from the socket layer; errors are logged only.
 */
export function scheduleVoiceMessageTranscription(input: {
  userId: string;
  mediaUrl: string;
  conversationId: string;
  messageId: string;
}): void {
  if (!env.OPENAI_API_KEY) {
    return;
  }

  void (async () => {
    try {
      const { buffer, filename, mime } = await fetchAudioBuffer(input.mediaUrl);
      const raw = await transcribeWithOpenAI(buffer, filename, mime);

      const text = raw.trim();
      if (!text) {
        console.info('[whisper] empty transcript, skipping save', { messageId: input.messageId });
        return;
      }

      await TranscriptModel.create({
        userId: new Types.ObjectId(input.userId),
        kind: 'voice_message',
        conversationId: new Types.ObjectId(input.conversationId),
        messageId: new Types.ObjectId(input.messageId),
        mediaUrl: input.mediaUrl.slice(0, 2000),
        rawText: text,
        language: 'auto',
        source: 'whisper',
        whisperModel: env.OPENAI_WHISPER_MODEL
      });
      console.info('[whisper] saved voice_message transcript', { messageId: input.messageId });
    } catch (e: unknown) {
      const code = e && typeof e === 'object' && 'code' in e ? Number((e as { code: unknown }).code) : undefined;
      if (code === 11000) {
        console.info('[whisper] duplicate message transcript skipped', { messageId: input.messageId });
        return;
      }
      console.error('[whisper] voice_message transcription failed', e);
    }
  })();
}
