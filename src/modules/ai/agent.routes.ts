import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { env } from '../../config/env';
import { AgentRunModel } from './agent-run.model';
import { advanceAgentRun, applyToolConfirmationsAndContinue } from './agent-runner.service';

export const aiAgentRouter = Router();

function singleParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  return null;
}

aiAgentRouter.post('/ai/agent/runs', requireAuth, async (req: AuthedRequest, res) => {
  const run = await AgentRunModel.create({
    userId: new Types.ObjectId(req.auth!.userId),
    status: 'active',
    messages: []
  });
  return res.status(201).json({ success: true, data: { runId: String(run._id) } });
});

aiAgentRouter.post('/ai/agent/runs/:runId/messages', requireAuth, async (req: AuthedRequest, res) => {
  const runId = singleParam(req.params.runId);
  if (!runId || !Types.ObjectId.isValid(runId)) {
    return res.status(400).json({ success: false, message: 'Invalid run id' });
  }
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    return res.status(400).json({ success: false, message: 'text is required' });
  }
  if (text.length > 8000) {
    return res.status(400).json({ success: false, message: 'text too long' });
  }

  const run = await AgentRunModel.findOne({ _id: runId, userId: new Types.ObjectId(req.auth!.userId) });
  if (!run) return res.status(404).json({ success: false, message: 'Run not found' });
  if (run.status === 'awaiting_confirmation') {
    return res.status(409).json({ success: false, message: 'Confirm or cancel pending tools before sending a new message.' });
  }
  if (run.status === 'cancelled') {
    return res.status(400).json({ success: false, message: 'This run was cancelled. Start a new run.' });
  }

  if (!env.CLAUDE_API_KEY?.trim()) {
    return res.json({
      success: true,
      data: {
        outcome: 'assistant_text',
        text: 'Connectify AI needs CLAUDE_API_KEY on the server. Add an Anthropic API key to enable the agent.',
        mock: true
      }
    });
  }

  run.messages.push({ role: 'user', content: text });
  run.markModified('messages');
  await run.save();

  const data = await advanceAgentRun(runId);
  return res.json({ success: true, data });
});

aiAgentRouter.post('/ai/agent/runs/:runId/confirm-tools', requireAuth, async (req: AuthedRequest, res) => {
  const runId = singleParam(req.params.runId);
  if (!runId || !Types.ObjectId.isValid(runId)) {
    return res.status(400).json({ success: false, message: 'Invalid run id' });
  }
  const approvals =
    req.body.approvals && typeof req.body.approvals === 'object' && !Array.isArray(req.body.approvals)
      ? (req.body.approvals as Record<string, boolean>)
      : {};

  if (!env.CLAUDE_API_KEY?.trim()) {
    return res.status(503).json({ success: false, message: 'AI not configured' });
  }

  const data = await applyToolConfirmationsAndContinue(runId, req.auth!.userId, approvals);
  return res.json({ success: true, data });
});

aiAgentRouter.post('/ai/agent/runs/:runId/cancel', requireAuth, async (req: AuthedRequest, res) => {
  const runId = singleParam(req.params.runId);
  if (!runId || !Types.ObjectId.isValid(runId)) {
    return res.status(400).json({ success: false, message: 'Invalid run id' });
  }
  const run = await AgentRunModel.findOneAndUpdate(
    { _id: runId, userId: new Types.ObjectId(req.auth!.userId) },
    { $set: { status: 'cancelled' } },
    { new: true }
  );
  if (!run) return res.status(404).json({ success: false, message: 'Run not found' });
  return res.json({ success: true, data: { cancelled: true } });
});
