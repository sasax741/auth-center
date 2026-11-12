const REQUIRED_KEYS = [
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'ALLOWED_CLIENTS',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'JWT_KID',
] as const;

export function parseAllowedClients(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((client) => client.trim())
    .filter(Boolean);
}

export function parseCorsOrigins(value: string | undefined): string[] {
  return parseAllowedClients(value);
}

/**
 * Rejects an incomplete environment while the application boots, so a
 * misconfigured deployment fails immediately instead of serving requests with
 * weaker guarantees than intended.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const missing: string[] = REQUIRED_KEYS.filter((key) => {
    const value = config[key];
    return value === undefined || value === null || `${value}`.trim() === '';
  });

  if (!config.REDIS_URL && !config.REDIS_HOST) {
    missing.push('REDIS_URL or REDIS_HOST');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration: ${missing.join(', ')}. ` +
        'Provide it through the environment or the .env file.',
    );
  }

  if (parseAllowedClients(config.ALLOWED_CLIENTS as string).length === 0) {
    throw new Error(
      'ALLOWED_CLIENTS must contain at least one client identifier',
    );
  }

  return config;
}
