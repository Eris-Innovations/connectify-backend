# LiveKit self-host (Connectify)

Target host: `livekit.myconnectify.co` → `165.22.51.209`

Deploy path on VPS: `/opt/livekit`

## Quick deploy

```bash
# On the VPS as root
mkdir -p /opt/livekit
cd /opt/livekit
# Copy files from this directory, then:
cp .env.example .env
# Fill LIVEKIT_API_KEY / LIVEKIT_API_SECRET (generate with: openssl rand -hex 16 / openssl rand -hex 32)
docker compose up -d
systemctl enable --now livekit-docker
```

Firewall ports: `80/tcp`, `443/tcp`, `7881/tcp`, `3478/udp`, `50000-60000/udp`.

Backend env on the same VPS:

```
LIVEKIT_URL=wss://livekit.myconnectify.co
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```
