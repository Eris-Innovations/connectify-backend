#!/usr/bin/env bash
# Run on the VPS as root. Copies expected to live in /opt/livekit.
set -euo pipefail

DOMAIN="${LIVEKIT_DOMAIN:-livekit.myconnectify.co}"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  API_KEY="API$(openssl rand -hex 8)"
  API_SECRET="$(openssl rand -hex 32)"
  cat > .env <<EOF
LIVEKIT_DOMAIN=${DOMAIN}
LIVEKIT_API_KEY=${API_KEY}
LIVEKIT_API_SECRET=${API_SECRET}
EOF
  echo "Wrote ${ROOT_DIR}/.env with generated API key/secret"
else
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  API_KEY="${LIVEKIT_API_KEY:?}"
  API_SECRET="${LIVEKIT_API_SECRET:?}"
  DOMAIN="${LIVEKIT_DOMAIN:-$DOMAIN}"
fi

export API_KEY API_SECRET DOMAIN

python3 - <<'PY'
from pathlib import Path
import os, re
text = Path('livekit.yaml').read_text()
key = os.environ['API_KEY']
secret = os.environ['API_SECRET']
if 'API_KEY_PLACEHOLDER' in text:
    text = text.replace('API_KEY_PLACEHOLDER', key).replace('API_SECRET_PLACEHOLDER', secret)
else:
    text = re.sub(
        r'keys:\n(?:  .+\n)+',
        f'keys:\n  {key}: {secret}\n',
        text,
        count=1,
    )
Path('livekit.yaml').write_text(text)
print('Rendered livekit.yaml keys')
PY

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  ufw allow 7881/tcp || true
  ufw allow 3478/udp || true
  ufw allow 50000:60000/udp || true
fi

docker compose pull
docker compose up -d --remove-orphans

# Nginx TLS front for signaling (do not touch ConnectifyWeb / other sites).
install -m 644 nginx-livekit.conf "/etc/nginx/sites-available/${DOMAIN}"
ln -sfn "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"

# Issue cert if missing (HTTP-01). Temporarily allow HTTP server without SSL first if needed.
if [[ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]]; then
  # Bootstrap HTTP-only server block so certbot can answer the challenge.
  cat > "/etc/nginx/sites-available/${DOMAIN}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 200 'livekit-bootstrap'; add_header Content-Type text/plain; }
}
EOF
  nginx -t
  systemctl reload nginx
  certbot certonly --webroot -w /var/www/html -d "${DOMAIN}" --non-interactive --agree-tos \
    --register-unsafely-without-email || \
  certbot certonly --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email
  install -m 644 nginx-livekit.conf "/etc/nginx/sites-available/${DOMAIN}"
fi

nginx -t
systemctl reload nginx

install -m 644 livekit-docker.service /etc/systemd/system/livekit-docker.service
systemctl daemon-reload
systemctl enable livekit-docker
systemctl restart livekit-docker

echo "=== LiveKit env for Connectify backend ==="
echo "LIVEKIT_URL=wss://${DOMAIN}"
echo "LIVEKIT_API_KEY=${API_KEY}"
echo "LIVEKIT_API_SECRET=${API_SECRET}"
echo
curl -sS -o /dev/null -w "https_${DOMAIN}=%{http_code}\n" "https://${DOMAIN}/" || true
docker compose ps
