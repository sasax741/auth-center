# --------------- Stage 1: Build ---------------
FROM node:20-alpine AS builder

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy dependency files
COPY package.json pnpm-lock.yaml ./

# Install ALL dependencies (including devDeps for building)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# Compile datasource.ts separately (it's outside src/)
RUN npx tsc datasource.ts --outDir dist --module commonjs --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --target es2021 --skipLibCheck

# --------------- Stage 2: Production ---------------
FROM node:20-alpine

# Create non-root user with explicit UID
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Copy package files for production install
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    pnpm install --prod --frozen-lockfile

# Copy built artifacts
COPY --from=builder /app/dist ./dist

# Create entrypoint script for migrations
RUN echo '#!/bin/sh\n\
set -e\n\
echo "Running database migrations..."\n\
node ./node_modules/typeorm/cli.js migration:run --dataSource dist/datasource.js\n\
echo "Migrations complete. Starting application..."\n\
exec node dist/main' > /app/docker-entrypoint.sh && \
    chmod +x /app/docker-entrypoint.sh && \
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
