FROM node:20-slim

# Install Playwright system dependencies
RUN npx playwright install-deps chromium

WORKDIR /app

# Copy package files and install ALL deps (need typescript for build)
COPY package.json package-lock.json ./
RUN npm ci && npx playwright install chromium

# Copy source and build
COPY tsconfig.json config.json ./
COPY src/ ./src/
RUN npx tsc

# Remove dev dependencies after build
RUN npm prune --omit=dev

# Create db directory
RUN mkdir -p db

ENV PORT=10000
EXPOSE 10000

CMD ["node", "dist/index.js"]
