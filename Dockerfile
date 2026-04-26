FROM node:22-bookworm-slim

# Install system Chromium, its dependencies, and supercronic in one layer
ARG SUPERCRONIC_VERSION=v0.2.33
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    curl \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/* \
    && ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "arm64" || echo "amd64") \
    && curl -fsSL "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${ARCH}" \
       -o /usr/local/bin/supercronic \
    && chmod +x /usr/local/bin/supercronic

# Tell Puppeteer to skip its Chromium download and use the system one
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install production dependencies only (skip express, only needed for one-time OAuth)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy app code and crontab
COPY src/ src/
COPY crontab .

ENTRYPOINT []
CMD ["supercronic", "-no-reap", "/app/crontab"]
