import { ConfigService } from '@nestjs/config';
import type { RedisClientOptions } from '@keyv/redis';

/**
 * Builds the Redis connection options shared by the cache and the rate limiter.
 * Prefers REDIS_URL when present, otherwise falls back to host/port, keeping
 * the optional ACL password on either branch.
 */
export function redisConnectionOptions(
  configService: ConfigService,
): RedisClientOptions {
  const url = configService.get<string>('REDIS_URL');
  const password = configService.get<string>('REDIS_PASSWORD');

  if (url) {
    return { url, ...(password ? { password } : {}) };
  }

  return {
    socket: {
      host: configService.get<string>('REDIS_HOST') || 'localhost',
      port: configService.get<number>('REDIS_PORT') || 6379,
      connectTimeout: 5000,
    },
    ...(password ? { password } : {}),
  };
}
