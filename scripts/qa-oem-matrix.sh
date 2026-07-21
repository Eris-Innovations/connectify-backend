#!/usr/bin/env bash
# OEM matrix runner: foreground / background / process-kill / force-stop
# Requires: adb device, peer credentials via env (never printed).
set -euo pipefail

ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
DEV="${QA_ADB_SERIAL:-192.168.18.107:33965}"
PKG=com.connectify.mobileapp
API="${QA_API_BASE:-https://connectify.eris-innovations.com/api/v1}"
PEER_EMAIL="${QA_PEER_EMAIL:?}"
PEER_PASSWORD="${QA_PEER_PASSWORD:?}"
TO_USER="${QA_TARGET_USER_ID:?}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${QA_OUT_DIR:-/tmp/connectify-oem-matrix}"
mkdir -p "$OUT_DIR"

run_peer() {
  local action="$1"
  local label="$2"
  echo ""
  echo "======== [$label] peer --action $action ========"
  (
    cd "$ROOT"
    ./node_modules/.bin/tsx "$ROOT/scripts/qa-peer-device.ts" \
      --api "$API" \
      --email "$PEER_EMAIL" \
      --password "$PEER_PASSWORD" \
      --toUserId "$TO_USER" \
      --action "$action" \
      --name Fareeha
  ) | tee "$OUT_DIR/${label}-${action}-peer.log"
}

start_log() {
  local label="$1"
  "$ADB" -s "$DEV" logcat -c || true
  rm -f "$OUT_DIR/${label}.logcat"
  ("$ADB" -s "$DEV" logcat -v time 2>/dev/null | rg --line-buffered -i \
    "SecurityException|FGS|microphone|ForegroundService|incoming_call|Fatal exception|AndroidRuntime|notifee|call\.telemetry|ReactNativeJS|FirebaseMessaging|FCM|com\.connectify\.mobileapp" \
    > "$OUT_DIR/${label}.logcat") &
  echo $! > "$OUT_DIR/${label}.logpid"
}

stop_log() {
  local label="$1"
  local pid
  pid="$(cat "$OUT_DIR/${label}.logpid" 2>/dev/null || true)"
  if [[ -n "${pid:-}" ]]; then kill "$pid" 2>/dev/null || true; fi
  sleep 1
}

app_pid() {
  "$ADB" -s "$DEV" shell pidof "$PKG" 2>/dev/null || true
}

ensure_foreground() {
  "$ADB" -s "$DEV" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
  sleep 3
  echo "[state] foreground pid=$(app_pid)"
}

ensure_background() {
  "$ADB" -s "$DEV" shell am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null 2>&1 || true
  sleep 2
  echo "[state] backgrounded (HOME); pid=$(app_pid)"
}

process_kill() {
  # Soft kill: process dies but package is NOT force-stopped (FCM should still wake).
  # am kill only works when the app is backgrounded — never call this while TOP.
  "$ADB" -s "$DEV" shell am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null 2>&1 || true
  sleep 2
  "$ADB" -s "$DEV" shell am kill "$PKG" >/dev/null 2>&1 || true
  sleep 2
  local p
  p="$(app_pid)"
  if [[ -n "${p:-}" ]]; then
    echo "[state] am kill left pid=$p — retrying via am kill after longer idle"
    sleep 2
    "$ADB" -s "$DEV" shell am kill "$PKG" >/dev/null 2>&1 || true
    sleep 2
    p="$(app_pid)"
  fi
  echo "[state] after am kill pid='${p:-none}' (expect empty; stopped must stay false)"
  "$ADB" -s "$DEV" shell dumpsys package "$PKG" 2>/dev/null | rg -o "User 0:.*stopped=(true|false)" | head -1 || true
}

force_stop() {
  "$ADB" -s "$DEV" shell am force-stop "$PKG"
  sleep 2
  local p
  p="$(app_pid)"
  echo "[state] after force-stop pid='${p:-none}'"
}

summarize() {
  local label="$1"
  echo "---- summary $label ----"
  echo "pid=$(app_pid)"
  rg -i "fgs\.success|incoming\.presented|call\.ended|SecurityException: Starting FGS|Fatal exception|You have a new message|call:ringing|FirebaseMessaging" \
    "$OUT_DIR/${label}.logcat" 2>/dev/null | head -40 || echo "(no matching log lines)"
  "$ADB" -s "$DEV" shell dumpsys notification --noredact 2>/dev/null \
    | rg -n "pkg=com\.connectify\.mobileapp|incoming_call_|channel=calls_v2|channel=messages_v2|android\.title=|android\.text=" \
    | head -40 || true
}

echo "[matrix] device=$DEV out=$OUT_DIR"
"$ADB" -s "$DEV" wait-for-device
"$ADB" -s "$DEV" shell getprop ro.product.model

# --- 1) FOREGROUND ---
ensure_foreground
start_log fg
run_peer message fg
sleep 4
run_peer call fg
sleep 12
stop_log fg
summarize fg

# --- 2) BACKGROUND ---
ensure_foreground
ensure_background
start_log bg
run_peer message bg
sleep 4
run_peer call bg
sleep 12
stop_log bg
summarize bg

# --- 3) PROCESS KILL (not force-stop) ---
ensure_foreground
sleep 2
process_kill
start_log killed
run_peer message killed
sleep 6
run_peer call killed
sleep 15
stop_log killed
summarize killed

# --- 4) FORCE STOP (OS boundary: expect no delivery until manual launch) ---
force_stop
start_log forcestop
run_peer message forcestop
sleep 6
run_peer call forcestop
sleep 15
stop_log forcestop
summarize forcestop

# Relaunch after force-stop so device is usable again
ensure_foreground
echo "[matrix] complete — logs in $OUT_DIR"
ls -la "$OUT_DIR"
