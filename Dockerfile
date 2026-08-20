FROM node:22-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev
RUN npx playwright install --with-deps chromium

# Minimal desktop stack: virtual display + window manager + noVNC + nginx.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      xauth xvfb x11vnc openbox novnc websockify nginx apache2-utils curl \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN chmod +x scripts/start-desktop.sh

# Automatically install the official Surfshark Chrome extension.
RUN node scripts/download-surfshark.js

ENV NODE_ENV=production
ENV PORT=10000
ENV APP_PORT=10001
ENV DISPLAY=:99

EXPOSE 10000

CMD ["/app/scripts/start-desktop.sh"]
