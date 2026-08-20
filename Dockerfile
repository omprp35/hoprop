FROM node:22-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev
RUN npx playwright install --with-deps chromium

COPY . .

# Fetch and unpack the official Surfshark Chrome extension during the image build.
RUN node scripts/download-surfshark.js

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

# Extensions require a headed Chromium context. Xvfb provides a virtual display.
CMD ["xvfb-run", "-a", "node", "src/server.js"]
