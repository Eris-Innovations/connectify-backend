/** Policy version bundled with transcription consent prompts (mobile + privacy policy). */
export const TRANSCRIPTION_POLICY_VERSION = '2026-07';

/** Consent purpose keys stored in ConsentRecord.purpose */
export const CONSENT_PURPOSES = {
  VOICE_TRANSCRIPTION: 'voice_transcription_v2026',
  CALL_TRANSCRIPTION: 'call_transcription_v2026',
  TERMS_OF_SERVICE: 'terms_of_service'
} as const;

/** Policy version for Terms of Use acceptance (Guideline 1.2). */
export const TERMS_OF_SERVICE_POLICY_VERSION = '2026-10';

export type TranscriptionConsentPurpose =
  (typeof CONSENT_PURPOSES)[keyof typeof CONSENT_PURPOSES];

export function withdrawalPurpose(purpose: string): string {
  return `${purpose}_withdrawal`;
}
