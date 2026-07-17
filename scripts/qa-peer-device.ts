/**
 * Peer QA harness: log in as a second account and send a chat message / ring
 * a physical device (e.g. Redmi) that is already signed into Connectify.
 *
 * Usage:
 *   node --import tsx scripts/qa-peer-device.ts \
 *     --api https://connectify.eris-innovations.com/api/v1 \
 *     --email peer@example.com \
 *     --password 'secret' \
 *     --toUserId 6a483295eb9b6a63c22dbbdc \
 *     --action both
 */
import path from 'path';

// Backend only ships socket.io server; reuse the mobile client package.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { io } = require(path.join(__dirname, '../../Mobile/node_modules/socket.io-client')) as typeof import('socket.io-client');
type Socket = import('socket.io-client').Socket;

type Args = {
  api: string;
  email: string;
  password: string;
  toUserId: string;
  action: 'message' | 'call' | 'both';
  conversationId?: string;
  name?: string;
};

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const api = get('--api') || process.env.QA_API_BASE || 'https://connectify.eris-innovations.com/api/v1';
  const email = get('--email') || process.env.QA_PEER_EMAIL;
  const password = get('--password') || process.env.QA_PEER_PASSWORD;
  const toUserId = get('--toUserId') || process.env.QA_TARGET_USER_ID;
  const action = (get('--action') || process.env.QA_ACTION || 'both') as Args['action'];
  const conversationId = get('--conversationId') || process.env.QA_CONVERSATION_ID;
  const name = get('--name') || process.env.QA_PEER_NAME || 'QA Peer';

  if (!email || !password || !toUserId) {
    console.error(`Missing required args.

Need:
  --email / QA_PEER_EMAIL          account that will SEND (friend of Redmi user)
  --password / QA_PEER_PASSWORD
  --toUserId / QA_TARGET_USER_ID   Mongo user id of the Redmi-signed-in account

Optional:
  --api ${api}
  --action message|call|both
  --conversationId dm:<a>:<b>
`);
    process.exit(1);
  }

  return { api, email, password, toUserId, action, conversationId, name };
}

function socketBase(api: string): string {
  return api.replace(/\/api\/v1\/?$/, '');
}

function minimalAudioOffer() {
  return {
    type: 'offer',
    sdp: [
      'v=0',
      'o=- 0 0 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'c=IN IP4 0.0.0.0',
      'a=rtcp:9 IN IP4 0.0.0.0',
      'a=ice-ufrag:qa',
      'a=ice-pwd:qaqaqaqaqaqaqaqaqaqaqa',
      'a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00',
      'a=setup:actpass',
      'a=mid:0',
      'a=sendrecv',
      'a=rtcp-mux',
      'a=rtpmap:111 opus/48000/2',
    ].join('\r\n') + '\r\n',
  };
}

async function login(api: string, email: string, password: string) {
  const res = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = (await res.json()) as {
    success?: boolean;
    message?: string;
    data?: { accessToken?: string; user?: { id?: string; name?: string } };
  };
  if (!res.ok || !json.data?.accessToken) {
    throw new Error(json.message || `Login failed (${res.status})`);
  }
  return {
    token: json.data.accessToken,
    userId: String(json.data.user?.id || ''),
    name: json.data.user?.name || 'QA Peer',
  };
}

async function authGet(api: string, token: string, path: string) {
  const res = await fetch(`${api}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as { success?: boolean; message?: string; data?: any };
  if (!res.ok) throw new Error(json.message || `GET ${path} failed (${res.status})`);
  return json.data;
}

async function resolveConversationId(
  api: string,
  token: string,
  peerUserId: string,
  targetUserId: string,
  explicit?: string
): Promise<string> {
  if (explicit) return explicit;
  const chats = await authGet(api, token, '/chats');
  const list = Array.isArray(chats) ? chats : chats?.chats || [];
  const dm = list.find((c: any) => {
    const id = String(c.id || c._id || '');
    return id.includes(targetUserId) && id.startsWith('dm:');
  });
  if (dm) return String(dm.id || dm._id);

  // Sorted pair form used by backend DM helper
  const [a, b] = [peerUserId, targetUserId].sort();
  return `dm:${a}:${b}`;
}

function connectSocket(api: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(socketBase(api), {
      transports: ['websocket'],
      auth: { token },
    });
    const timer = setTimeout(() => reject(new Error('Socket connect timeout')), 12_000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log('[qa] logging in peer', args.email, '→', args.api);
  const peer = await login(args.api, args.email, args.password);
  console.log('[qa] peer userId', peer.userId);

  if (peer.userId === args.toUserId) {
    throw new Error('Peer and target are the same user — use a friend account as --email');
  }

  const conversationId = await resolveConversationId(
    args.api,
    peer.token,
    peer.userId,
    args.toUserId,
    args.conversationId
  );
  console.log('[qa] conversationId', conversationId);

  const socket = await connectSocket(args.api, peer.token);
  console.log('[qa] socket connected', socket.id);

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  if (args.action === 'message' || args.action === 'both') {
    const clientId = `qa_${Date.now().toString(36)}`;
    const content = `QA ping ${new Date().toISOString()} — check Redmi tray/chat`;
    console.log('[qa] sending message', { conversationId, clientId });
    socket.emit('message:send', {
      conversationId,
      content,
      clientId,
    });
    await wait(1500);
  }

  if (args.action === 'call' || args.action === 'both') {
    console.log('[qa] initiating call to', args.toUserId);
    socket.emit('call:initiate', {
      to: args.toUserId,
      callerName: peer.name || args.name,
      offer: minimalAudioOffer(),
    });

    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 8000);
      for (const event of ['call:busy', 'call:failed', 'call:rejected', 'call:ringing', 'call:pending']) {
        socket.on(event, (payload) => {
          console.log(`[qa] ${event}`, payload);
          if (event !== 'call:ringing' && event !== 'call:pending') done();
        });
      }
    });
  }

  console.log('[qa] done — watch the Redmi for notification / incoming call UI');
  socket.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[qa] failed', err);
  process.exit(1);
});
