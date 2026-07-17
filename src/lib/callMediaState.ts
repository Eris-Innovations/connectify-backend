export type CallMediaState = 'connecting' | 'mediaConnected' | 'degraded' | 'reconnecting' | 'ended';

export type CallMediaEvent =
  | 'sdp_ready'
  | 'pc_connected'
  | 'remote_audio'
  | 'pc_disconnected'
  | 'pc_failed'
  | 'restart_begin'
  | 'restart_ok'
  | 'restart_exhausted'
  | 'end';

/** Shared with Mobile/utils/callMediaState.ts — keep transitions in sync. */
export function transitionCallMediaState(
  current: CallMediaState,
  event: CallMediaEvent
): CallMediaState {
  if (event === 'end' || event === 'restart_exhausted') return 'ended';
  switch (current) {
    case 'connecting':
      if (event === 'remote_audio') return 'mediaConnected';
      if (event === 'pc_disconnected' || event === 'pc_failed') return 'degraded';
      if (event === 'restart_begin') return 'reconnecting';
      return current;
    case 'mediaConnected':
      if (event === 'pc_disconnected' || event === 'pc_failed') return 'degraded';
      if (event === 'restart_begin') return 'reconnecting';
      return current;
    case 'degraded':
      if (event === 'restart_begin') return 'reconnecting';
      if (event === 'remote_audio' || event === 'restart_ok') return 'mediaConnected';
      return current;
    case 'reconnecting':
      if (event === 'remote_audio' || event === 'restart_ok' || event === 'pc_connected') {
        return 'mediaConnected';
      }
      if (event === 'pc_failed') return 'degraded';
      return current;
    case 'ended':
      return 'ended';
    default:
      return current;
  }
}

export function shouldAttemptIceRestart(state: CallMediaState, attempts: number, maxAttempts = 3): boolean {
  if (attempts >= maxAttempts) return false;
  return state === 'degraded' || state === 'reconnecting' || state === 'connecting';
}
