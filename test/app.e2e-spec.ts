import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { DataSource } from 'typeorm';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, GLOBAL_PREFIX } from './../src/app.setup';
import { MailClientService } from './../src/mail/mail-client.service';

/**
 * Runs against the local development stack (see docker-compose.dev.yml) and
 * expects the migrations to be applied already. Host overrides live in
 * setup-env.ts so they are in place before the application module is loaded.
 */
const runId = Date.now();
const webEmail = `e2e-${runId}-web@test.dev`;
const mobileEmail = `e2e-${runId}-mobile@test.dev`;
const password = 'secret123';
const newPassword = 'secret456';

const verificationTokens = new Map<string, string>();
const resetTokens = new Map<string, string>();

describe('Authentication service (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let webUserId: number;
  let accessToken: string;
  let refreshToken: string;

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailClientService)
      .useValue({
        sendVerificationEmail: jest.fn(async (to: string, token: string) => {
          verificationTokens.set(to, token);
        }),
        sendPasswordResetEmail: jest.fn(async (to: string, token: string) => {
          resetTokens.set(to, token);
        }),
      })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 1,
          timeToExpire: 60,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        `DELETE FROM "user" WHERE email LIKE 'e2e-%@test.dev'`,
      );
    }

    await app
      ?.get<Cache & { disconnect?: () => Promise<void> }>(CACHE_MANAGER)
      ?.disconnect?.();
    await app?.close();
  });

  it('reports the database and cache as healthy', async () => {
    const response = await api().get('/health').expect(200);

    expect(response.body.details).toEqual({
      database: { status: 'up' },
      redis: { status: 'up' },
    });
  });

  it('publishes the key set used to verify tokens', async () => {
    const response = await api().get('/.well-known/jwks.json').expect(200);

    expect(response.body.keys).toHaveLength(1);
    expect(response.body.keys[0]).toEqual(
      expect.objectContaining({ kty: 'RSA', alg: 'RS256', use: 'sig' }),
    );
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
  });

  it('registers a user without echoing the password hash', async () => {
    const response = await api()
      .post(`/${GLOBAL_PREFIX}/auth/register`)
      .send({
        name: 'Web',
        lastName: 'Tester',
        email: webEmail,
        password,
        client: 'web',
      })
      .expect(201);

    webUserId = response.body.id;
    expect(response.body).not.toHaveProperty('password');
    expect(verificationTokens.get(webEmail)).toBeDefined();
  });

  it('refuses the registration of a client outside the configured list', async () => {
    await api()
      .post(`/${GLOBAL_PREFIX}/auth/register`)
      .send({
        name: 'Rogue',
        lastName: 'Client',
        email: `e2e-${runId}-rogue@test.dev`,
        password,
        client: 'unknown-app',
      })
      .expect(401);
  });

  it('refuses to log in before the email is verified', async () => {
    await api()
      .post(`/${GLOBAL_PREFIX}/auth/login`)
      .send({ email: webEmail, password, client: 'web' })
      .expect(401);
  });

  it('verifies the email with the token sent to the user', async () => {
    await api()
      .post(`/${GLOBAL_PREFIX}/auth/verify-email`)
      .send({ token: verificationTokens.get(webEmail) })
      .expect(201);
  });

  it('issues an access and a refresh token on login', async () => {
    const response = await api()
      .post(`/${GLOBAL_PREFIX}/auth/login`)
      .send({ email: webEmail, password, client: 'web' })
      .expect(201);

    accessToken = response.body.token;
    refreshToken = response.body.refresh_token;
    expect(accessToken).toBeDefined();
    expect(refreshToken).toBeDefined();
  });

  it('lists only the users of the calling client', async () => {
    const response = await api()
      .get(`/${GLOBAL_PREFIX}/users`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ email: webEmail })]),
    );
    expect(JSON.stringify(response.body)).not.toContain('password');
  });

  it('hides users that belong to another client', async () => {
    await api()
      .post(`/${GLOBAL_PREFIX}/auth/register`)
      .send({
        name: 'Mobile',
        lastName: 'Tester',
        email: mobileEmail,
        password,
        client: 'mobile',
      })
      .expect(201);

    const response = await api()
      .get(`/${GLOBAL_PREFIX}/users`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(JSON.stringify(response.body)).not.toContain(mobileEmail);
  });

  it('refuses a request without a token', async () => {
    await api().get(`/${GLOBAL_PREFIX}/users`).expect(401);
  });

  it('rejects a non numeric id instead of failing internally', async () => {
    await api()
      .delete(`/${GLOBAL_PREFIX}/auth/deleteUser/not-a-number`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('rotates the refresh token and revokes the family on a replay', async () => {
    const rotated = await api()
      .post(`/${GLOBAL_PREFIX}/auth/refresh`)
      .send({ refresh_token: refreshToken })
      .expect(201);

    const newRefreshToken = rotated.body.refresh_token;
    expect(newRefreshToken).not.toBe(refreshToken);

    await api()
      .post(`/${GLOBAL_PREFIX}/auth/refresh`)
      .send({ refresh_token: refreshToken })
      .expect(401);

    await api()
      .post(`/${GLOBAL_PREFIX}/auth/refresh`)
      .send({ refresh_token: newRefreshToken })
      .expect(401);

    const relogin = await api()
      .post(`/${GLOBAL_PREFIX}/auth/login`)
      .send({ email: webEmail, password, client: 'web' })
      .expect(201);

    accessToken = relogin.body.token;
    refreshToken = relogin.body.refresh_token;

    await api()
      .post(`/${GLOBAL_PREFIX}/auth/refresh`)
      .send({ refresh_token: refreshToken })
      .expect(201);
  });

  it('invalidates the access token after logout', async () => {
    const login = await api()
      .post(`/${GLOBAL_PREFIX}/auth/login`)
      .send({ email: webEmail, password, client: 'web' })
      .expect(201);

    const token = login.body.token;

    await api()
      .post(`/${GLOBAL_PREFIX}/auth/logout`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await api()
      .get(`/${GLOBAL_PREFIX}/users`)
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('resets the password through the emailed token', async () => {
    await api()
      .post(`/${GLOBAL_PREFIX}/auth/forgot-password`)
      .send({ email: webEmail })
      .expect(201);

    await api()
      .post(`/${GLOBAL_PREFIX}/auth/reset-password`)
      .send({ token: resetTokens.get(webEmail), password: newPassword })
      .expect(201);

    await api()
      .post(`/${GLOBAL_PREFIX}/auth/login`)
      .send({ email: webEmail, password: newPassword, client: 'web' })
      .expect(201);
  });

  it('answers generically for an unknown account without sending mail', async () => {
    await api()
      .post(`/${GLOBAL_PREFIX}/auth/forgot-password`)
      .send({ email: `e2e-${runId}-ghost@test.dev` })
      .expect(201);

    expect(resetTokens.get(`e2e-${runId}-ghost@test.dev`)).toBeUndefined();
  });

  it('deletes the caller account', async () => {
    await api()
      .delete(`/${GLOBAL_PREFIX}/auth/deleteUser/${webUserId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });
});
