import axios from 'axios';
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { AgentRunModel, type AgentRunDocument } from './agent-run.model';
import { AGENT_TOOLS, AGENT_SYSTEM_PROMPT, TOOLS_REQUIRING_CONFIRMATION } from './agent.tools';
import { UserModel } from '../users/user.model';
import { ChannelModel } from '../channels/channel.model';

type ContentBlock = Record<string, unknown> & { type: string };

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n').trim();
}

function extractToolUses(content: unknown): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  if (!Array.isArray(content)) return [];
  const out: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
  for (const block of content as ContentBlock[]) {
    if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      const input = block.input && typeof block.input === 'object' ? (block.input as Record<string, unknown>) : {};
      out.push({ id: block.id, name: block.name, input });
    }
  }
  return out;
}

async function callAnthropicMessages(messages: unknown[]): Promise<{ content: unknown[]; stopReason?: string }> {
  if (!env.CLAUDE_API_KEY?.trim()) {
    throw new Error('CLAUDE_API_KEY_MISSING');
  }

  const response = await axios.post(
    env.CLAUDE_API_URL,
    {
      model: env.CLAUDE_MODEL,
      max_tokens: 2048,
      system: AGENT_SYSTEM_PROMPT,
      tools: AGENT_TOOLS,
      messages
    },
    {
      headers: {
        'x-api-key': env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 60_000
    }
  );

  const content = response.data?.content;
  if (!Array.isArray(content)) {
    return { content: [{ type: 'text', text: 'Unexpected model response shape.' }], stopReason: response.data?.stop_reason };
  }
  return { content, stopReason: response.data?.stop_reason };
}

export async function executeAgentTool(
  userId: string,
  name: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const uid = new Types.ObjectId(userId);

  if (name === 'get_me') {
    const user = await UserModel.findById(userId).lean();
    if (!user) return { ok: false, error: 'User not found' };
    return {
      ok: true,
      name: user.name,
      username: user.username,
      email: user.email,
      bio: user.bio,
      isVerified: user.isVerified,
      hasCompletedProfile: user.hasCompletedProfile
    };
  }

  if (name === 'list_my_channels') {
    const channels = await ChannelModel.find({
      $or: [{ ownerId: uid }, { members: uid }]
    })
      .sort({ updatedAt: -1 })
      .limit(25)
      .lean();
    return {
      ok: true,
      channels: channels.map((c) => ({
        id: String(c._id),
        name: c.name,
        members: c.members.length,
        isOwner: String(c.ownerId) === userId
      }))
    };
  }

  if (name === 'join_channel') {
    const channelId = typeof input.channelId === 'string' ? input.channelId.trim() : '';
    if (!channelId || !Types.ObjectId.isValid(channelId)) return { ok: false, error: 'invalid channelId' };
    const channel = await ChannelModel.findById(channelId);
    if (!channel) return { ok: false, error: 'channel not found' };
    const already = String(channel.ownerId) === userId || channel.members.some((m) => String(m) === userId);
    if (already) return { ok: true, joined: true, alreadyMember: true };
    channel.members = [...channel.members, uid];
    await channel.save();
    return { ok: true, joined: true, channelId: String(channel._id) };
  }

  return { ok: false, error: `unknown tool ${name}` };
}

export type AgentStepResult =
  | { outcome: 'assistant_text'; text: string; mock?: boolean }
  | {
      outcome: 'confirmation_required';
      pendingTools: Array<{ id: string; name: string; input: Record<string, unknown> }>;
      preamble?: string;
    }
  | { outcome: 'error'; message: string; mock?: boolean };

async function reloadRun(runId: string): Promise<AgentRunDocument | null> {
  return AgentRunModel.findById(runId);
}

export async function advanceAgentRun(runId: string): Promise<AgentStepResult> {
  const run = await reloadRun(runId);
  if (!run) return { outcome: 'error', message: 'Run not found' };

  if (!env.CLAUDE_API_KEY?.trim()) {
    return {
      outcome: 'error',
      message: 'AI is not configured (missing CLAUDE_API_KEY on the server).',
      mock: true
    };
  }

  const userId = String(run.userId);
  let inner = 0;
  while (inner < 8) {
    inner += 1;
    let completion: { content: unknown[]; stopReason?: string };
    try {
      completion = await callAnthropicMessages(run.messages as unknown[]);
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'response' in e ? JSON.stringify((e as { response?: { data?: unknown } }).response?.data) : String(e);
      return { outcome: 'error', message: msg.slice(0, 500) };
    }

    run.messages.push({ role: 'assistant', content: completion.content });
    run.markModified('messages');
    await run.save();

    const toolUses = extractToolUses(completion.content);
    const preamble = extractTextFromContent(completion.content);

    if (toolUses.length === 0) {
      run.status = 'active';
      await run.save();
      return { outcome: 'assistant_text', text: preamble || 'Done.' };
    }

    if (toolUses.some((t) => TOOLS_REQUIRING_CONFIRMATION.has(t.name))) {
      run.status = 'awaiting_confirmation';
      await run.save();
      return {
        outcome: 'confirmation_required',
        pendingTools: toolUses.map((t) => ({ id: t.id, name: t.name, input: t.input })),
        preamble: preamble || undefined
      };
    }

    const toolResults = [];
    for (const tu of toolUses) {
      const result = await executeAgentTool(userId, tu.name, tu.input);
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
    }
    run.messages.push({ role: 'user', content: toolResults });
    run.markModified('messages');
    await run.save();
  }

  return { outcome: 'error', message: 'Too many tool steps in one turn.' };
}

export async function applyToolConfirmationsAndContinue(
  runId: string,
  userId: string,
  approvals: Record<string, boolean>
): Promise<AgentStepResult> {
  const run = await AgentRunModel.findOne({ _id: runId, userId: new Types.ObjectId(userId) });
  if (!run) return { outcome: 'error', message: 'Run not found' };
  if (run.status !== 'awaiting_confirmation') {
    return { outcome: 'error', message: 'No pending tools to confirm.' };
  }

  const last = run.messages[run.messages.length - 1] as { role?: string; content?: unknown } | undefined;
  if (!last || last.role !== 'assistant') {
    return { outcome: 'error', message: 'Invalid conversation state.' };
  }

  const toolUses = extractToolUses(last.content);
  if (!toolUses.length) {
    return { outcome: 'error', message: 'No tool uses in last assistant message.' };
  }

  const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = [];
  for (const tu of toolUses) {
    const approved = approvals[tu.id] === true;
    if (!approved) {
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify({ ok: false, error: 'User denied this action in the app.' })
      });
      continue;
    }
    const result = await executeAgentTool(userId, tu.name, tu.input);
    toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
  }

  run.messages.push({ role: 'user', content: toolResults });
  run.status = 'active';
  run.markModified('messages');
  await run.save();

  return advanceAgentRun(runId);
}
