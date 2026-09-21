import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const probeKey = `health_probe:${uuidv4()}`;

    try {
      await this.cacheManager.set(probeKey, 'ok', 5000);
      const value = await this.cacheManager.get<string>(probeKey);
      await this.cacheManager.del(probeKey);

      return value === 'ok'
        ? indicator.up()
        : indicator.down({ message: 'Cache returned an unexpected value' });
    } catch (error) {
      return indicator.down({ message: error.message });
    }
  }
}
