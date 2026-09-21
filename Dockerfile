# --------------- Stage 1: Build ---------------
FROM node:20-alpine AS builder

# Enable pnpm via corepack (pnpm@9 for Node.js 20 compatibility)
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy dependency files
COPY package.json pnpm-lock.yaml ./

# Install ALL dependencies (including devDeps for building)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application (emits dist/src plus dist/datasource.js for migrations)
RUN pnpm run build

# --------------- Stage 2: Production ---------------
FROM node:20-alpine

# Create non-root user with explicit UID
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Copy package files for production install
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only (pnpm@9 for Node.js 20 compatibility)
RUN corepack enable && corepack prepare pnpm@9 --activate && \
    pnpm install --prod --frozen-lockfile

# Copy built artifacts and entrypoint
COPY --from=builder /app/dist ./dist
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh && \
    chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application
ENTRYPOINT ["/app/docker-entrypoint.sh"]
