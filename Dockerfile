FROM node:22-bookworm

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

RUN npx playwright install --with-deps chromium

RUN apt-get update && \
    apt-get install -y xauth && \
    rm -rf /var/lib/apt/lists/*

COPY . .

RUN node scripts/download-surfshark.js

ENV NODE_ENV=production

EXPOSE 8080

CMD ["xvfb-run", "-a", "node", "src/server.js"]
