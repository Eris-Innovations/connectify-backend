# LiveKit self-host (Connectify)

Target host: `livekit.myconnectify.co` → `165.22.51.209`

Deploy path on VPS: `/opt/livekit`

This stack uses **Docker Compose for LiveKit + Redis**, with **host nginx** terminating TLS
(Caddy is not used because nginx already owns `:80`/`:443` on this VPS).

## Quick deploy

```bash
# On the VPS as root
mkdir -p /opt/livekit
# Copy this directory to /opt/livekit, then:
cd /opt/livekit
bash ./install.sh
```

`install.sh` will:
- generate `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` into `/opt/livekit/.env` if missing
- install Docker if needed
- start LiveKit + Redis (Redis on `127.0.0.1:6380`)
- enable nginx site + Certbot for `livekit.myconnectify.co`
- enable `livekit-docker.service`

Firewall ports: `80/tcp`, `443/tcp`, `7881/tcp`, `3478/udp`, `50000-60000/udp`.

Backend env on the same VPS:

```
LIVEKIT_URL=wss://livekit.myconnectify.co
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```
