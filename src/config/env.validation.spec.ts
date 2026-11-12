import {
  parseAllowedClients,
  parseCorsOrigins,
  validateEnv,
} from './env.validation';

const validEnv = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USER: 'root',
  DB_PASSWORD: 'password',
  DB_NAME: 'auth',
  REDIS_HOST: 'localhost',
  ALLOWED_CLIENTS: 'web,mobile',
  JWT_PRIVATE_KEY: 'private',
  JWT_PUBLIC_KEY: 'public',
  JWT_KID: 'kid',
};

describe('validateEnv', () => {
  it('accepts a complete environment', () => {
    expect(validateEnv({ ...validEnv })).toEqual(validEnv);
  });

  it('accepts a redis url instead of a host', () => {
    const env = {
      ...validEnv,
      REDIS_HOST: undefined,
      REDIS_URL: 'redis://cache:6379',
    };

    expect(() => validateEnv(env)).not.toThrow();
  });

  it('lists every missing key at once', () => {
    expect(() => validateEnv({})).toThrow(
      /DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, ALLOWED_CLIENTS, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, JWT_KID/,
    );
  });

  it('requires a reachable cache definition', () => {
    const env = { ...validEnv, REDIS_HOST: undefined };

    expect(() => validateEnv(env)).toThrow(/REDIS_URL or REDIS_HOST/);
  });

  it('refuses an empty allow list so clients are never accepted by default', () => {
    expect(() => validateEnv({ ...validEnv, ALLOWED_CLIENTS: ' , ' })).toThrow(
      'ALLOWED_CLIENTS must contain at least one client identifier',
    );
  });
});

describe('parseAllowedClients', () => {
  it('trims entries and drops empty ones', () => {
    expect(parseAllowedClients(' web , mobile ,, ')).toEqual(['web', 'mobile']);
  });

  it('returns nothing when the value is absent', () => {
    expect(parseAllowedClients(undefined)).toEqual([]);
  });

  it('parses cors origins with the same rules', () => {
    expect(parseCorsOrigins('https://a.dev, https://b.dev')).toEqual([
      'https://a.dev',
      'https://b.dev',
    ]);
  });
});
