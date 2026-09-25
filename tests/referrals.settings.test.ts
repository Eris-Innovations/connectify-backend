import { describe, expect, it } from 'vitest';
import { setReferralMilestone } from '../src/modules/referrals/referral.models';

describe('setReferralMilestone', () => {
  it('rejects a milestone outside 1 to 100', async () => {
    await expect(setReferralMilestone(0)).rejects.toThrow(/milestone/i);
    await expect(setReferralMilestone(101)).rejects.toThrow(/milestone/i);
  });
});
