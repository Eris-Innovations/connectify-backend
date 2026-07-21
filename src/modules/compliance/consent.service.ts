import { Types } from 'mongoose';
import { ConsentRecordModel } from './consent-record.model';
import { withdrawalPurpose, CONSENT_PURPOSES } from './consent.constants';

/**
 * Returns true when the user has an active grant for `purpose` that was not superseded
 * by a later withdrawal record.
 */
export async function hasActiveConsent(userId: string, purpose: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(userId)) return false;

  const uid = new Types.ObjectId(userId);
  const revokePurpose = withdrawalPurpose(purpose);

  const [grant, revoke] = await Promise.all([
    ConsentRecordModel.findOne({ userId: uid, purpose }).sort({ acceptedAt: -1 }).lean(),
    ConsentRecordModel.findOne({ userId: uid, purpose: revokePurpose }).sort({ acceptedAt: -1 }).lean()
  ]);

  if (!grant) return false;
  if (!revoke) return true;
  return grant.acceptedAt > revoke.acceptedAt;
}

/** Latest grant/withdrawal state per known transcription purpose. */
export async function getTranscriptionConsentStatus(userId: string): Promise<{
  voiceTranscription: boolean;
  callTranscription: boolean;
}> {
  const [voiceTranscription, callTranscription] = await Promise.all([
    hasActiveConsent(userId, CONSENT_PURPOSES.VOICE_TRANSCRIPTION),
    hasActiveConsent(userId, CONSENT_PURPOSES.CALL_TRANSCRIPTION)
  ]);
  return { voiceTranscription, callTranscription };
}
