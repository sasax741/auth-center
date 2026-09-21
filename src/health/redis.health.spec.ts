import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HealthIndicatorService } from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;
  let cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    cache = {
      get: jest.fn(async () => 'ok'),
      set: jest.fn(async () => undefined),
      del: jest.fn(async () => true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisHealthIndicator,
        { provide: CACHE_MANAGER, useValue: cache },
        {
          provide: HealthIndicatorService,
          useValue: new HealthIndicatorService(),
        },
      ],
    }).compile();

    indicator = module.get<RedisHealthIndicator>(RedisHealthIndicator);
  });

  it('reports up when the cache answers the probe and cleans it up', async () => {
    const result = await indicator.isHealthy('redis');

    expect(result).toEqual({ redis: { status: 'up' } });
    const probeKey = cache.set.mock.calls[0][0] as string;
    expect(probeKey).toMatch(/^health_probe:/);
    expect(cache.del).toHaveBeenCalledWith(probeKey);
  });

  it('reports down when the cache returns an unexpected value', async () => {
    cache.get.mockResolvedValue('something-else');

    await expect(indicator.isHealthy('redis')).resolves.toEqual({
      redis: {
        status: 'down',
        message: 'Cache returned an unexpected value',
      },
    });
  });

  it('reports down with the error when the cache is unreachable', async () => {
    cache.set.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(indicator.isHealthy('redis')).resolves.toEqual({
      redis: { status: 'down', message: 'ECONNREFUSED' },
    });
  });
});
