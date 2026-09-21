/**
 * Runs before any test module is imported, so the values below win over both
 * the shell environment and the .env file that ConfigModule reads while the
 * application module is loaded.
 *
 * The suite talks to the development stack from the host, so container
 * internal hostnames are never used unless explicitly requested through
 * E2E_DB_HOST / E2E_REDIS_HOST (useful when running inside compose).
 */
process.env.DB_HOST = process.env.E2E_DB_HOST ?? 'localhost';
process.env.REDIS_HOST = process.env.E2E_REDIS_HOST ?? 'localhost';
process.env.ALLOWED_CLIENTS ??= 'web,mobile';
