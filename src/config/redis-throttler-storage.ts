import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { createClient } from '@keyv/redis';
import type { RedisClientOptions } from '@keyv/redis';

type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

const INCREMENT_SCRIPT = `
local hitKey = KEYS[1]
local blockKey = KEYS[1] .. ':blocked'
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

local blocked = redis.call('EXISTS', blockKey) == 1
local hits = 0

if blocked == 1 then
  hits = tonumber(redis.call('GET', hitKey) or '0')
else
  hits = redis.call('INCR', hitKey)
  if hits == 1 then
    redis.call('PEXPIRE', hitKey, ttl)
  end
  if hits > limit then
    redis.call('SET', blockKey, '1', 'PX', blockDuration)
    blocked = 1
  end
end

local timeToExpire = redis.call('PTTL', hitKey)
if timeToExpire < 0 then
  timeToExpire = ttl
end

local timeToBlockExpire = 0
if blocked == 1 then
  timeToBlockExpire = redis.call('PTTL', blockKey)
  if timeToBlockExpire < 0 then
    timeToBlockExpire = blockDuration
  end
end

return { hits, timeToExpire, blocked and 1 or 0, timeToBlockExpire }
`;

/**
 * Redis-backed {@link ThrottlerStorage}. It replaces the default in-memory
 * store so the rate limits are shared across every replica, which is required
 * behind a load balancer. The counting is done atomically with a Lua script
 * so concurrent requests cannot race past a limit.
 *
 * Redis is already a hard dependency of the service (refresh tokens, token
 * revocation and verification tokens), so a storage failure opens the request
 * instead of turning the outage into a 500 from the guard.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly client: ReturnType<typeof createClient>;

  constructor(options: RedisClientOptions) {
    this.client = createClient(options);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    void _throttlerName;
    try {
      await this.ensureConnected();

      const [hits, timeToExpire, isBlocked, timeToBlockExpire] =
        (await this.client.eval(INCREMENT_SCRIPT, {
          keys: [`rt:${key}`],
          arguments: [String(ttl), String(limit), String(blockDuration)],
        })) as number[];

      return {
        totalHits: hits,
        timeToExpire: Math.ceil(timeToExpire / 1000),
        isBlocked: isBlocked === 1,
        timeToBlockExpire: Math.ceil(timeToBlockExpire / 1000),
      };
    } catch (error) {
      this.logger.warn(
        `Rate limit storage unavailable, allowing request: ${error.message}`,
      );
      return {
        totalHits: 0,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }
}
