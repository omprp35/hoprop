#!/usr/bin/env bash
set -euo pipefail

PUBLIC_PORT="${PORT:-10000}"
APP_PORT="${APP_PORT:-10001}"
DISPLAY_NUM="${DISPLAY:-:99}"
DESKTOP_USERNAME="${DESKTOP_USERNAME:-browser}"
DESKTOP_PASSWORD="${DESKTOP_PASSWORD:-}"

if [[ -z "$DESKTOP_PASSWORD" ]]; then
  echo "ERROR: DESKTOP_PASSWORD is required for the private noVNC desktop." >&2
  echo "Add DESKTOP_PASSWORD in Railway Variables, then redeploy." >&2
  exit 1
fi

mkdir -p /tmp/.X11-unix /tmp/novnc /tmp/nginx
rm -f /tmp/.X99-lock

# Basic-auth protects the public noVNC URL.
htpasswd -bc /tmp/novnc/.htpasswd "$DESKTOP_USERNAME" "$DESKTOP_PASSWORD" >/dev/null

cat > /tmp/nginx.conf <<NGINX
worker_processes 1;
pid /tmp/nginx.pid;
error_log /dev/stderr info;
events { worker_connections 1024; }
http {
  access_log /dev/stdout;
  client_max_body_size 20m;

  map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
  }

  server {
    listen ${PUBLIC_PORT};
    server_name _;

    # RDP-like desktop. Protected independently from Telegram.
    location /desktop/ {
      auth_basic "Private browser desktop";
      auth_basic_user_file /tmp/novnc/.htpasswd;

      proxy_pass http://127.0.0.1:6080/;
      proxy_http_version 1.1;
      proxy_set_header Upgrade \$http_upgrade;
      proxy_set_header Connection \$connection_upgrade;
      proxy_set_header Host \$host;
      proxy_read_timeout 3600s;
      proxy_send_timeout 3600s;
    }

    # Telegram webhook, healthcheck and normal app routes.
    location / {
      proxy_pass http://127.0.0.1:${APP_PORT};
      proxy_http_version 1.1;
      proxy_set_header Host \$host;
      proxy_set_header X-Forwarded-Proto \$scheme;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_read_timeout 3600s;
    }
  }
}
NGINX

export DISPLAY="$DISPLAY_NUM"
export APP_PORT

cleanup() {
  echo "Stopping desktop services..."
  kill "${NODE_PID:-}" "${WS_PID:-}" "${VNC_PID:-}" "${WM_PID:-}" "${XVFB_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting virtual desktop on DISPLAY=$DISPLAY..."
Xvfb "$DISPLAY" -screen 0 1365x900x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!
sleep 1

openbox-session >/tmp/openbox.log 2>&1 &
WM_PID=$!

# VNC only listens inside the container; nginx/basic-auth is the public boundary.
x11vnc -display "$DISPLAY" -localhost -forever -shared -rfbport 5900 -nopw \
  -noxdamage -repeat -xkb >/tmp/x11vnc.log 2>&1 &
VNC_PID=$!

# Serve noVNC locally. nginx publishes it under /desktop/.
websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/websockify.log 2>&1 &
WS_PID=$!

# Node stays on an internal port because nginx owns Railway's public PORT.
echo "Starting Telegram/browser app on internal port $APP_PORT..."
node src/server.js &
NODE_PID=$!

# Wait until Node answers before accepting Railway healthchecks.
for i in {1..30}; do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$NODE_PID" 2>/dev/null; then
    echo "Node app exited during startup." >&2
    wait "$NODE_PID"
  fi
  sleep 1
done

echo "Starting nginx on public port $PUBLIC_PORT..."
nginx -c /tmp/nginx.conf -g 'daemon off;' &
NGINX_PID=$!

# If Node exits, stop the container instead of leaving a false-healthy desktop proxy.
wait "$NODE_PID"
