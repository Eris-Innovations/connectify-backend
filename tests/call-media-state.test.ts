import { describe, expect, it } from 'vitest';
import {
  shouldAttemptIceRestart,
  transitionCallMediaState
} from '../src/lib/callMediaState';

describe('call media state machine', () => {
  it('does not mark mediaConnected from SDP alone', () => {
    expect(transitionCallMediaState('connecting', 'sdp_ready')).toBe('connecting');
    expect(transitionCallMediaState('connecting', 'pc_connected')).toBe('connecting');
    expect(transitionCallMediaState('connecting', 'remote_audio')).toBe('mediaConnected');
  });

  it('moves through degraded → reconnecting → mediaConnected', () => {
    let state = transitionCallMediaState('mediaConnected', 'pc_disconnected');
    expect(state).toBe('degraded');
    state = transitionCallMediaState(state, 'restart_begin');
    expect(state).toBe('reconnecting');
    state = transitionCallMediaState(state, 'remote_audio');
    expect(state).toBe('mediaConnected');
  });

  it('bounds ICE restart attempts', () => {
    expect(shouldAttemptIceRestart('degraded', 2)).toBe(true);
    expect(shouldAttemptIceRestart('degraded', 3)).toBe(false);
    expect(shouldAttemptIceRestart('ended', 0)).toBe(false);
  });
});
