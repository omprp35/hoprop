FROM node:22-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev
RUN npx playwright install --with-deps chromium

# Desktop stack for an RDP-like browser session in Railway:
# Xvfb = virtual monitor, Openbox = window manager,
# x11vnc = VNC server, noVNC/websockify = browser client,
# nginx = exposes Telegram API + noVNC on Railway's single public port.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      xauth xvfb x11vnc openbox novnc websockify nginx apache2-utils curl \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN chmod +x scripts/start-desktop.sh

# Fetch and unpack the official Surfshark Chrome extension during image build.
RUN node scripts/download-surfshark.js

ENV NODE_ENV=production
ENV PORT=10000
ENV APP_PORT=10001
ENV DISPLAY=:99

EXPOSE 10000

CMD ["/app/scripts/start-desktop.sh"]
