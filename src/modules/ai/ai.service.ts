import axios from 'axios';
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { TranscriptModel } from './transcript.model';
import { RecapModel } from './recap.model';

type ClaudeRecapResponse = {
  summary: string;
  actionItems: { task: string; assignee?: string; dueDate?: string }[];
  keyDecisions: string[];
};

export class AiService {
  async generateMeetingRecap(callSessionId: string) {
    const oid = Types.ObjectId.isValid(callSessionId) ? new Types.ObjectId(callSessionId) : callSessionId;
    const transcript = await TranscriptModel.findOne({ callSessionId: oid }).lean();
    if (!transcript) {
      throw new Error('Transcript not found for call');
    }

    const prompt = [
      'You are an assistant generating meeting recaps.',
      'Given the transcript below, extract:',
      '1) A concise 3-sentence summary of the meeting',
      '2) Action items as JSON array: [{ "task": string, "assignee": string, "dueDate": string }]',
      '3) Key decisions as bullet list (one per line).',
      '',
      'Return a JSON object with fields: summary, actionItems, keyDecisions.',
      '',
      'Transcript:',
      transcript.rawText
    ].join('\n');

    const response = await axios.post(
      env.CLAUDE_API_URL,
      {
        model: env.CLAUDE_MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'x-api-key': env.CLAUDE_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 25_000
      }
    );

    const content = typeof response.data?.content === 'string' ? response.data.content : JSON.stringify(response.data?.content ?? {});

    let parsed: ClaudeRecapResponse;
    try {
      parsed = JSON.parse(content) as ClaudeRecapResponse;
    } catch {
      parsed = {
        summary: transcript.rawText.slice(0, 400),
        actionItems: [],
        keyDecisions: []
      };
    }

    const created = await RecapModel.create({
      callSessionId: new Types.ObjectId(callSessionId),
      summary: parsed.summary,
      actionItems: parsed.actionItems,
      keyDecisions: parsed.keyDecisions
    });

    return created;
  }

  async summariseThread(threadText: string) {
    const prompt = [
      'You are an assistant generating chat thread summaries.',
      'Given the chat log below, produce a concise 5-bullet recap.',
      '',
      'Chat log:',
      threadText
    ].join('\n');

    const response = await axios.post(
      env.CLAUDE_API_URL,
      {
        model: env.CLAUDE_MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'x-api-key': env.CLAUDE_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 10_000
      }
    );

    const content = response.data?.content;
    if (typeof content === 'string') {
      return { bullets: content.split('\n').filter((line: string) => line.trim().length > 0).slice(0, 5) };
    }
    return { bullets: [] };
  }
}

export const aiService = new AiService();

