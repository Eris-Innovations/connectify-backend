import { describe, expect, it } from 'vitest';
import { withdrawalPurpose, CONSENT_PURPOSES, TRANSCRIPTION_POLICY_VERSION } from '../src/modules/compliance/consent.constants';

describe('transcription consent constants', () => {
  it('defines stable purpose keys', () => {
    expect(CONSENT_PURPOSES.VOICE_TRANSCRIPTION).toBe('voice_transcription_v2026');
    expect(CONSENT_PURPOSES.CALL_TRANSCRIPTION).toBe('call_transcription_v2026');
    expect(TRANSCRIPTION_POLICY_VERSION).toMatch(/^\d{4}-\d{2}$/);
  });

  it('builds withdrawal purpose from grant purpose', () => {
    expect(withdrawalPurpose(CONSENT_PURPOSES.VOICE_TRANSCRIPTION)).toBe(
      'voice_transcription_v2026_withdrawal'
    );
  });
});
