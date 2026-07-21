import { describe, expect, it } from 'vitest';
import {
  authorizeActiveCallSignal,
  authorizeCallEnd,
} from '../src/modules/calls/call-authorization';

describe('active call signaling authorization', () => {
  const active = { callId: 'call-1', otherUserId: 'peer-1' };

  it('authorizes signaling only to the active peer', () => {
    expect(authorizeActiveCallSignal(active, 'peer-1', 'call-1')).toBe('ok');
    expect(authorizeActiveCallSignal(active, 'attacker-target', 'call-1')).toBe(
      'no_active_call'
    );
    expect(authorizeActiveCallSignal(null, 'peer-1', 'call-1')).toBe('no_active_call');
  });

  it('rejects a mismatched call id', () => {
    expect(authorizeActiveCallSignal(active, 'peer-1', 'call-2')).toBe(
      'call_id_mismatch'
    );
    expect(authorizeActiveCallSignal(active, 'peer-1')).toBe('ok');
  });
});

describe('call:end authorization', () => {
  const pending = {
    callId: 'call-pending',
    callerId: 'caller-1',
    callerName: 'Caller',
    isVideo: false,
    offer: {},
    createdAt: new Date().toISOString(),
  };

  it('allows the active peer to end', () => {
    expect(
      authorizeCallEnd({
        me: 'me',
        other: 'peer-1',
        active: { callId: 'call-1', otherUserId: 'peer-1' },
        pendingAsCallee: null,
        pendingAsCaller: null,
      })
    ).toEqual({ ok: true, callId: 'call-1' });
  });

  it('allows callee or caller to end a pending ring', () => {
    expect(
      authorizeCallEnd({
        me: 'callee-1',
        other: 'caller-1',
        active: null,
        pendingAsCallee: pending,
        pendingAsCaller: null,
      })
    ).toEqual({ ok: true, callId: 'call-pending' });

    expect(
      authorizeCallEnd({
        me: 'caller-1',
        other: 'callee-1',
        active: null,
        pendingAsCallee: null,
        pendingAsCaller: pending,
      })
    ).toEqual({ ok: true, callId: 'call-pending' });
  });

  it('rejects strangers and call-id mismatches', () => {
    expect(
      authorizeCallEnd({
        me: 'attacker',
        other: 'callee-1',
        active: null,
        pendingAsCallee: null,
        pendingAsCaller: pending,
      })
    ).toEqual({ ok: false, code: 'unauthorized_signal' });

    expect(
      authorizeCallEnd({
        me: 'me',
        other: 'peer-1',
        requestedCallId: 'wrong',
        active: { callId: 'call-1', otherUserId: 'peer-1' },
        pendingAsCallee: null,
        pendingAsCaller: null,
      })
    ).toEqual({ ok: false, code: 'unauthorized_signal' });
  });
});
