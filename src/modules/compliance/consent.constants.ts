/** Policy version bundled with transcription consent prompts (mobile + privacy policy). */
export const TRANSCRIPTION_POLICY_VERSION = '2026-07';

/** Consent purpose keys stored in ConsentRecord.purpose */
export const CONSENT_PURPOSES = {
  VOICE_TRANSCRIPTION: 'voice_transcription_v2026',
  CALL_TRANSCRIPTION: 'call_transcription_v2026'
} as const;

export type TranscriptionConsentPurpose =
  (typeof CONSENT_PURPOSES)[keyof typeof CONSENT_PURPOSES];

export function withdrawalPurpose(purpose: string): string {
  return `${purpose}_withdrawal`;
}
