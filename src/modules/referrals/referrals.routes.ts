import { Router } from 'express';
import { z } from 'zod';
import { StatusCodes } from 'http-status-codes';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { asyncHandler } from '../../shared/errors';
import { requireAdminCapability } from '../admin/access';
import { getReferralSettings, setReferralMilestone } from './referral.models';
import { ReferralError, createReferralInvite, getMyReferrals, listPayouts, markPayoutPaid } from './referral.service';

export const referralsRouter = Router();

function sendReferralError(res: { status: (code: number) => { json: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof ReferralError) {
    return res.status(error.status).json({ success: false, message: error.message });
  }
  throw error;
}

referralsRouter.post(
  '/invites',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = z.object({ email: z.string().trim().email() }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'Enter a valid email address.' });
    }
    try {
      const data = await createReferralInvite(req.auth!.userId, parsed.data.email);
      return res.status(StatusCodes.CREATED).json({ success: true, data });
    } catch (error) {
      return sendReferralError(res, error);
    }
  })
);

referralsRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = await getMyReferrals(req.auth!.userId);
    return res.status(StatusCodes.OK).json({ success: true, data });
  })
);

export const referralAdminRouter = Router();

referralAdminRouter.get(
  '/admin/referrals/settings',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const actor = await requireAdminCapability(req, res, 'user_management');
    if (!actor) return;
    const data = await getReferralSettings();
    return res.status(StatusCodes.OK).json({ success: true, data });
  })
);

referralAdminRouter.put(
  '/admin/referrals/settings',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const actor = await requireAdminCapability(req, res, 'user_management');
    if (!actor) return;
    const parsed = z.object({ milestone: z.number().int() }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'Milestone must be an integer from 1 to 100.' });
    }
    try {
      const data = await setReferralMilestone(parsed.data.milestone);
      return res.status(StatusCodes.OK).json({ success: true, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save milestone.';
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message });
    }
  })
);

referralAdminRouter.get(
  '/admin/referrals/payouts',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const actor = await requireAdminCapability(req, res, 'user_management');
    if (!actor) return;
    const status = req.query.status === 'paid' ? 'paid' : 'ready';
    const data = await listPayouts(status);
    return res.status(StatusCodes.OK).json({ success: true, data });
  })
);

referralAdminRouter.post(
  '/admin/referrals/payouts/:userId/paid',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const actor = await requireAdminCapability(req, res, 'user_management');
    if (!actor) return;
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    try {
      await markPayoutPaid(userId, req.auth!.userId);
      return res.status(StatusCodes.OK).json({ success: true });
    } catch (error) {
      return sendReferralError(res, error);
    }
  })
);
