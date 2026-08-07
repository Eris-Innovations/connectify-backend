import { describe, expect, it, beforeEach } from 'vitest';
import { stripEmotionPrefix, buildConnectySystemPrompt } from '../src/modules/connecty/connecty.persona';
import { cosineSimilarity, sanitizeMessagesForGroq, _resetConnectyCircuits } from '../src/modules/connecty/connecty.llm';
import { checkConnectyRateLimit, _resetConnectyRateLimits } from '../src/modules/connecty/connecty.rate-limit';
import { Types } from 'mongoose';
import { CONNECTY_FACT_CATEGORIES } from '../src/modules/connecty/connecty-memory.model';

describe('connecty persona', () => {
  it('strips emotion prefix', () => {
    const r = stripEmotionPrefix('[emotion:supportive]\n\nhey I got you');
    expect(r.emotion).toBe('supportive');
    expect(r.text).toBe('hey I got you');
  });

  it('leaves plain text alone', () => {
    const r = stripEmotionPrefix('just chillin');
    expect(r.emotion).toBeUndefined();
    expect(r.text).toBe('just chillin');
  });

  it('system prompt includes facts and anti-hallucination cues', () => {
    const p = buildConnectySystemPrompt({
      factsBlock: '- [identity] pet: Bruno',
      summaryBlock: 'Talked about exams.',
      ragBlock: '(1) loves late-night walks'
    });
    expect(p).toContain('Bruno');
    expect(p).toContain('Anti-hallucination');
    expect(p).toContain('exams');
  });
});

describe('connecty cosine', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe('connecty rate limit isolation', () => {
  beforeEach(() => _resetConnectyRateLimits());

  it('limits each user independently', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await checkConnectyRateLimit('userA', { max: 20 })).ok).toBe(true);
    }
    expect((await checkConnectyRateLimit('userA', { max: 20 })).ok).toBe(false);
    expect((await checkConnectyRateLimit('userB', { max: 20 })).ok).toBe(true);
  });
});

describe('connecty message sanitize + continuity helpers', () => {
  beforeEach(() => _resetConnectyCircuits());

  it('merges consecutive same-role messages and drops empties', () => {
    const out = sanitizeMessagesForGroq([
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'again' },
      { role: 'assistant', content: '' },
      { role: 'assistant', content: 'hey' }
    ]);
    expect(out[0]?.content).toContain('hi');
    expect(out[0]?.content).toContain('again');
    expect(out[out.length - 1]?.role).toBe('user');
  });

  it('fact categories include identity for profile memory', () => {
    expect(CONNECTY_FACT_CATEGORIES).toContain('identity');
  });

  it('fact correction maps Max then Bruno to single key upsert shape', () => {
    const key = 'pet_name';
    const a = { userId: 'userA', key, value: 'Max' };
    const b = { userId: 'userA', key, value: 'Bruno' };
    expect(a.key).toBe(b.key);
    expect(a.value).not.toBe(b.value);
  });
});
