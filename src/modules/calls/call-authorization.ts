import type { ActiveCallRecord } from './active-call.service';
import type { PendingCallRecord } from './pending-call.service';

export function authorizeActiveCallSignal(
  active: ActiveCallRecord | null,
  targetUserId: string,
  requestedCallId?: string
): 'ok' | 'no_active_call' | 'call_id_mismatch' {
  if (!active || active.otherUserId !== targetUserId) return 'no_active_call';
  if (requestedCallId && requestedCallId !== active.callId) return 'call_id_mismatch';
  return 'ok';
}

export type AuthorizeCallEndInput = {
  me: string;
  other?: string;
  requestedCallId?: string;
  active: ActiveCallRecord | null;
  pendingAsCallee: PendingCallRecord | null;
  pendingAsCaller: PendingCallRecord | null;
};

export type AuthorizeCallEndResult =
  | { ok: true; callId: string }
  | { ok: false; code: 'unauthorized_signal' };

/**
 * Caller or callee may end only a call they are actually in (pending or active).
 */
export function authorizeCallEnd(input: AuthorizeCallEndInput): AuthorizeCallEndResult {
  const { me, other, requestedCallId, active, pendingAsCallee, pendingAsCaller } = input;

  if (
    active &&
    (!other || active.otherUserId === other) &&
    (!requestedCallId || requestedCallId === active.callId)
  ) {
    return { ok: true, callId: active.callId };
  }

  if (
    pendingAsCallee &&
    (!other || pendingAsCallee.callerId === other) &&
    (!requestedCallId || requestedCallId === pendingAsCallee.callId)
  ) {
    return { ok: true, callId: pendingAsCallee.callId };
  }

  if (
    pendingAsCaller &&
    pendingAsCaller.callerId === me &&
    (!requestedCallId || requestedCallId === pendingAsCaller.callId)
  ) {
    return { ok: true, callId: pendingAsCaller.callId };
  }

  return { ok: false, code: 'unauthorized_signal' };
}
