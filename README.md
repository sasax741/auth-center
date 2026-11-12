# API Auth — Microservicio de Autenticación

Microservicio de autenticación construido con NestJS que emite tokens JWT firmados con **RS256** (firma asimétrica). Se encarga exclusivamente de **AuthN** (verificar quién es el usuario); la **AuthZ** (qué puede hacer) queda en manos de los servicios de negocio.

---

## Stack Tecnológico

| Componente   | Tecnología                                |
|-------------|-------------------------------------------|
| Framework   | NestJS + TypeScript                       |
| Base de datos | PostgreSQL 16 + TypeORM (migraciones)   |
| Cache / Blacklist | Redis 7 (via @keyv/redis)                 |
| JWT         | RS256 (claves RSA de 2048 bits)           |
| OAuth       | Google (Authorization Code)               |
| Contenedores | Imagen Docker (Swarm) + Compose para desarrollo local |
| Seguridad HTTP | helmet + límite de body + allow list de clientes |
| Rate Limiting | @nestjs/throttler (3 niveles, almacenamiento distribuido en Redis) |
| Sesiones | authVersion + soft-delete + logout-all (invalidación de todas las sesiones) |
| Tracing     | Correlation ID + AsyncLocalStorage        |

---

## Arquitectura

```mermaid
C4Context
    title System Context — API Auth

    Person(client, "Client", "Web / Mobile app que consume endpoints de auth")

    System_Boundary(auth, "API Auth Service") {
        Container(api, "NestJS App", "Node.js, TypeScript", "AuthN: register, login, login con Google, logout, JWKS")
        ContainerDb(pg, "PostgreSQL", "TypeORM", "Almacena usuarios (name, email, password hash, client, provider)")
        ContainerDb(redis, "Redis", "@keyv/redis", "Blacklist de tokens revocados, refresh y verify tokens")
    }

    System_Ext(business, "External Microservices", "Servicios de negocio que consumen JWKS para validar tokens")

    Rel(client, api, "HTTP /api/v1/auth/*", "HTTPS")
    Rel(api, pg, "TypeORM", "SQL")
    Rel(api, redis, "Redis protocol", "Cache")
    Rel(business, api, "GET /.well-known/jwks.json", "HTTPS")
    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

El servicio expone un endpoint `/.well-known/jwks.json` (sin prefijo `/api/v1`) para que clientes o gateways obtengan la clave pública y validen tokens de forma desacoplada.

### API Gateway (Traefik) — Validación Centralizada

En producción se recomienda que un **API Gateway** (Traefik, Kong, etc.) sea el único punto de entrada y valide los tokens JWT centralizadamente:

```mermaid
flowchart LR
    C[Client] -->|Request + Bearer JWT| GW[API Gateway<br>Traefik]
    GW -->|GET /.well-known/jwks.json| AUTH[API Auth]
    AUTH -->|Public Key JWKS| GW
    GW -->|Valida firma RS256<br>exp, audience| GW
    GW -->|Token válido| MS1[Microservicio<br>de Negocio]
    GW -->|Token inválido| ERR[401 Unauthorized]
    MS1 -->|sub + X-User-ID| DB[(DB Roles<br>y Permisos)]

    style GW fill:#fff3bf,stroke:#e67700
    style ERR fill:#ffc9c9,stroke:#e03131
    style MS1 fill:#d0bfff,stroke:#6741d9
```

**Consecuencia importante:** los microservicios de negocio **no validan nada del JWT**. El gateway:

1. Obtiene la clave pública del endpoint `/.well-known/jwks.json`
2. Valida la firma RS256, expiración, audience y blacklist
3. Si el token es inválido → responde `401` directo, el request nunca llega al microservicio
4. Si es válido → reenvía el request con headers de confianza (`X-User-ID`, `X-User-Email`)

El microservicio recibe el `X-User-ID` y solo consulta su propia base de datos de roles/permisos para autorizar la operación. Esto desacopla completamente AuthN (Gateway + API Auth) de AuthZ (cada microservicio).

---

## Endpoints

Todos los endpoints operativos están prefijados con `/api/v1`.

| Verbo   | Ruta                             | Descripción                                                                 | Auth | Rate Limit     |
|:--------|:---------------------------------|:----------------------------------------------------------------------------|:-----|:---------------|
| `POST`  | `/auth/register`                 | Registra un nuevo usuario + envía email de verificación                        | No   | 5 req/min      |
| `POST`  | `/auth/login`                    | Autentica con email/password y devuelve JWT RS256 + refresh_token        | No   | 5 req/min      |
| `POST`  | `/auth/google`                   | Autentica con Google (Authorization Code) + crea usuario si no existe. Devuelve JWT + refresh_token | No   | 5 req/min      |
| `POST`  | `/auth/refresh`                  | Canjea refresh token por nuevo access token + nuevo refresh token (rotación) | No   | 10 req/min     |
| `POST`  | `/auth/logout`                   | Revoca el token actual (agrega jti a Redis blacklist)                       | Sí   | Global         |
| `POST`  | `/auth/logout-all`               | Revoca todas las sesiones del usuario (incrementa `authVersion`)            | Sí   | Global         |
| `POST`  | `/auth/verify-email`             | Verifica el email con token recibido por correo                             | No   | 5 req/min      |
| `POST`  | `/auth/resend-verification`      | Reenvía el email de verificación (usuario no verificado)                    | No   | 5 req/min      |
| `POST`  | `/auth/change-password`          | Cambia la contraseña y revoca todas las sesiones                            | Sí   | Global         |
| `DELETE`| `/auth/deleteUser/:id`           | Soft-delete de usuario (solo el propio dueño)                               | Sí   | 5 req/min      |
| `POST`  | `/auth/forgot-password`          | Envía email con token para resetear contraseña (rate limit por email)       | No   | 3 req/min      |
| `POST`  | `/auth/reset-password`           | Resetea la contraseña con el token recibido por correo                      | No   | 3 req/min      |
| `GET`   | `/users`                         | Lista usuarios (paginado: `?page=1&limit=10`)                               | Sí   | Global         |
| `GET`   | `/users/me`                      | Obtiene el usuario autenticado                                              | Sí   | Global         |
| `PATCH` | `/users/me`                      | Actualiza el perfil del usuario autenticado                                 | Sí   | Global         |
| `GET`   | `/users/:id`                     | Obtiene un usuario por ID                                                   | Sí   | Global         |
| `GET`   | `/health`                        | Health check con ping a PostgreSQL y Redis                                  | No   | Global         |
| `GET`   | `/.well-known/jwks.json`         | Clave pública en formato JWKS (ruta absoluta, sin prefijo)                  | No   | Global         |

---

## Flujos de Autenticación

```mermaid
sequenceDiagram
    participant C as Client
    participant API as API Auth (NestJS)
    participant PG as PostgreSQL
    participant R as Redis
    participant ML as Mail Service

    Note over C,R: REGISTER
    C->>API: POST /api/v1/auth/register
    API->>API: Validar DTO (name, email, password, client)
    API->>PG: Verificar email único
    API->>API: Hash password (bcrypt, 10 rounds)
    API->>PG: INSERT user (transaction)
    PG-->>API: User saved
    API->>API: Generar verify_token → Redis (24h TTL)
    API->>API: Enviar email de verificación (vía Mail Service)
    API-->>C: 201 { id, name, email, client }

    Note over C,R: VERIFY EMAIL
    C->>API: POST /api/v1/auth/verify-email { token }
    API->>R: GET verify_token:{token}
    R-->>API: email
    API->>PG: UPDATE user SET emailVerifiedAt = now()
    PG-->>API: OK
    API->>R: DEL verify_token:{token}
    API-->>C: 200 { message: "Email verified successfully" }

    Note over C,R: LOGIN
    C->>API: POST /api/v1/auth/login
    API->>PG: Buscar usuario por email
    PG-->>API: User data (password hash, emailVerifiedAt)
    API->>API: Comparar bcrypt hash
    API->>API: Verificar emailVerifiedAt != null
    API->>API: Firmar JWT RS256 { sub, aud, jti, iss, exp, nbf }
    API->>R: SET refresh_token:{uuid} → userId (7d TTL)
    API-->>C: 200 { email, token, refresh_token }

    Note over C,R: REFRESH TOKEN
    C->>API: POST /api/v1/auth/refresh { refresh_token }
    API->>R: GET refresh_token:{refreshToken}
    R-->>API: userId
    API->>R: DEL refresh_token:{refreshToken} (rotación)
    API->>API: Firmar nuevo JWT RS256
    API->>R: SET refresh_token:{newUuid} → userId (7d TTL)
    API-->>C: 200 { email, token, refresh_token }

    Note over C,R: LOGOUT
    C->>API: POST /api/v1/auth/logout (Bearer JWT)
    API->>API: AuthGuard — verificar firma JWT
    API->>API: Extraer jti + exp del payload
    API->>R: SET jti → "revoked" (TTL = exp - now)
    R-->>API: OK
    API-->>C: 200 { message: "Logout successful" }

    Note over C,R: FORGOT PASSWORD
    C->>API: POST /api/v1/auth/forgot-password { email, callback_url? }
    API->>R: Check forgot_rate:{email} (5min cooldown)
    API->>R: SET forgot_rate:{email}
    API->>PG: Buscar usuario por email
    PG-->>API: User data
    API->>API: Generar reset_token → Redis (15min TTL)
    API->>ML: POST /api/send { to, subject, body }
    ML-->>API: 200 { success }
    API-->>C: 200 { message: "If the email exists..." }

    Note over C,R: RESET PASSWORD
    C->>API: POST /api/v1/auth/reset-password { token, password }
    API->>R: GET reset_token:{token}
    R-->>API: email
    API->>PG: UPDATE user SET password = bcrypt(newPass)
    API->>R: DEL reset_token:{token}
    API-->>C: 200 { message: "Password reset successful" }
```

### Payload del JWT

| Claim | Descripción                                |
|:------|:-------------------------------------------|
| `sub` | ID del usuario                             |
| `aud` | Cliente destino (multi-tenant)             |
| `iss` | `"auth waves"`                             |
| `jti` | UUID único — previene replay attacks       |
| `iat` | Emitido en                                |
| `nbf` | Válido desde                              |
| `exp` | Expira en (1 día por defecto)              |
| `authVersion` | Versión de sesión: si es menor a la actual, el token se rechaza (logout-all / cambio de contraseña) |

---

## Validación de Tokens

El `AuthGuard` se ejecuta en los endpoints protegidos. El flujo de validación es:

```mermaid
flowchart TD
    Start([Request con Bearer token]) --> Extract[Extraer JWT del<br>header Authorization]
    Extract --> Verify{Verificar firma<br>JWT con RS256?}
    Verify -->|Clave pública<br>+ algoritmo RS256| Expired{Token<br>expirado?}
    Expired -->|Sí| DenyExp[401 Unauthorized<br>Token expirado]
    Expired -->|No| Blacklist{Consultar Redis:<br>jti en blacklist?}

    Blacklist -->|jti encontrado| DenyRev[401 Unauthorized<br>Token revocado]
    Blacklist -->|jti no encontrado| AuthVersion{¿authVersion<br>vigente?}

    AuthVersion -->|No| DenyVersion[401 Unauthorized<br>Sesión invalidada]
    AuthVersion -->|Sí| Allow[Permitir request<br>→ Controller]

    DenyExp --> Response[Respuesta JSON error]
    DenyRev --> Response
    DenyVersion --> Response

    style Allow fill:#b2f2bb,stroke:#2f9e44,color:#2f9e44
    style DenyExp fill:#ffc9c9,stroke:#e03131,color:#e03131
    style DenyRev fill:#ffc9c9,stroke:#e03131,color:#e03131
    style DenyVersion fill:#ffc9c9,stroke:#e03131,color:#e03131
    style Verify fill:#ffec99,stroke:#e67700,color:#e67700
    style Expired fill:#ffec99,stroke:#e67700,color:#e67700
    style Blacklist fill:#ffec99,stroke:#e67700,color:#e67700
```

## Refresh Token

El login devuelve un `refresh_token` además del access token JWT:

```json
{
  "email": "user@example.com",
  "token": "eyJhbG...",
  "refresh_token": "550e8400-e29b-41d4-a716-446655440000"
}
```

- El refresh token es un UUID v4 almacenado en Redis con **7 días de TTL**
- Cuando expira el access token, el cliente puede llamar a `POST /auth/refresh`
- **Rotación**: al usar un refresh token, se invalida el anterior y se genera uno nuevo
- **Detección de reuso**: el token rotado queda marcado. Si se presenta otra vez (robo), se revoca toda la familia de refresh tokens de esa cuenta y el usuario debe loguearse de nuevo
- El endpoint `POST /auth/logout` revoca solo el access token actual; para logout completo descartar el refresh token del lado del cliente
- El endpoint `POST /auth/logout-all` incrementa `authVersion` y revoca la familia de refresh tokens, invalidando **todas** las sesiones activas del usuario

---

## Verificación de Email

Al registrarse, el usuario recibe un email con un token de verificación. El login solo se permite si `emailVerifiedAt` no es null.

**Flujo:**

```
POST /auth/register → email con token de verificación → POST /auth/verify-email { token }
```

El token expira en **24 horas**. Si no se verifica, se puede reenviar un nuevo token con `POST /auth/resend-verification`:

```json
{ "email": "user@example.com", "callback_url": "https://miapp.com/verify" }
```

Este endpoint responde de forma genérica (no revela si el email existe) y no reenvía si el email ya está verificado.

---

## Forgot / Reset Password

**`POST /auth/forgot-password`** acepta un `callback_url` opcional. Si se envía, el email incluye un link clickable; si no, solo el token plano:

```json
// Con callback — link directo en el email
{ "email": "user@example.com", "callback_url": "https://miapp.com/reset-password" }

// Sin callback — solo el token en el email
{ "email": "user@example.com" }
```

**Rate limit por email:** máximo 1 solicitud cada 5 minutos por dirección de correo (independiente del rate limit global).

---

## Google OAuth (Login con cuenta de Google)

El servicio soporta autenticación delegada a Google mediante **Authorization Code + PKCE** desde el frontend, con intercambio server-side del código.

### Flujo

```
1. Frontend → redirige a Google OAuth (sin client_secret, solo client_id)
2. Google → usuario se autentica y autoriza
3. Google → redirige al frontend con ?code=xxx
4. Frontend → POST /api/v1/auth/google { code, client }
5. API Auth → intercambia code por id_token (server-side, usando client_secret)
6. API Auth → extrae email, given_name, family_name del id_token
7. API Auth → busca/crea usuario (provider='google', emailVerifiedAt=automático)
8. API Auth → emite JWT RS256 + refresh_token
```

### Comportamiento según estado del usuario

| Usuario existe? | Provider | Comportamiento |
|:----------------|:---------|:---------------|
| No              | —        | Crea usuario con `name`, `lastName`, `email`, `provider='google'`, `emailVerifiedAt=now()`, `password=NULL` |
| Sí              | `google` | Login normal → emite JWT + refresh_token |
| Sí              | `local`  | ❌ 400 — "This email is already registered with a different method" |
| Sí (borrado)    | cualquiera | ❌ 400 — "The user has already been deleted" |

### Restricciones para usuarios de Google

- No pueden hacer login con `POST /auth/login` (no tienen password)
- No pueden resetear contraseña con `POST /auth/forgot-password` (reciben mensaje genérico)
- No necesitan verificar email (`emailVerifiedAt` se setea automáticamente)

### Configuración

Crear credenciales OAuth 2.0 en [Google Cloud Console](https://console.cloud.google.com/apis/credentials) y configurar:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxx
```

Para SPAs (Single Page Applications): el `redirect_uri` usado en el intercambio es `postmessage`. Para Web tradicionales, configurar el `redirect_uri` correspondiente y pasarlo en el DTO.

---

## Mail Service

Este servicio no envía emails directamente. Delega en un **Mail Service externo** (Go) que expone `POST /api/send`:

```json
{
  "to": ["user@example.com"],
  "subject": "Password Reset",
  "body": "<h2>...</h2>",
  "is_html": true
}
```

Configurable vía `MAIL_SERVICE_URL=http://mail:8080`.

### Contrato de integración

- **Remitente**: el auth service **no** envía `from`; lo toma el mail service desde `FROM_ADDRESS` (server-side).
- **Idempotencia**: cada email se envía con el header `Idempotency-Key`, derivado del token correspondiente (`password-reset:<token>` o `verify-email:<token>`). Si se reintenta una petición con la misma key y payload, el mail service no reenvía el email.
- **Timeout**: el `HttpModule` usa `MAIL_SERVICE_TIMEOUT` (ms, default `90000`), alineado al presupuesto máximo de latencia del mail service (`SMTP_TIMEOUT × SMTP_MAX_ATTEMPTS` + backoff). Si el SMTP se demora, el auth service no corta la petición antes de que termine la entrega.
- **`MAIL_SERVICE_URL` por entorno**: en red interna/Swarm usar `http://mail:8080` (nombre del servicio); solo en desarrollo local usar `http://localhost:8080`.

---

## JWT RS256 (Firma Asimétrica)

Se usa RS256 en lugar de HS256 (simétrica) por las siguientes ventajas:

- La **clave privada** solo está en este servicio (firma tokens)
- La **clave pública** se distribuye segura vía JWKS (cualquier servicio verifica)
- Los servicios de negocio no necesitan compartir un secreto con el auth service
- Rotación de claves posible sin coordinación entre servicios

Para generar las claves:

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

Luego copiar el contenido de cada archivo a las variables `JWT_PRIVATE_KEY` y `JWT_PUBLIC_KEY` del `.env`.

---

## IDs de Correlación

Cada request recibe un `X-Correlation-ID` (UUID v4). Si el cliente no lo envía, el middleware lo genera automáticamente.

- **Middleware**: `CorrelationIdMiddleware` — captura/genera el ID y lo almacena en `AsyncLocalStorage`
- **Logger**: `CustomLogger` — todos los logs incluyen el correlation ID
- **Interceptor**: `LoggingInterceptor` — logea `{method} {url} {statusCode} {duration}ms`

Esto permite rastrear una petición completa a través de múltiples servicios en la traza.

---

## Rate Limiting

El throttler usa **almacenamiento distribuido en Redis** (`RedisThrottlerStorage`), por lo que los límites se comparten entre todas las réplicas del servicio (no hay estado en memoria). Para que el `X-Forwarded-For` se respete detrás de un proxy/load balancer, configura `TRUST_PROXY`:

```env
TRUST_PROXY=1          # número de hops de confianza, o una subred/host (lo que acepta Express 'trust proxy')
```

Tres niveles configurados globalmente:

| Nivel    | Límite              | Ventana |
|:---------|:--------------------|:--------|
| short    | 3 requests          | 1s      |
| medium   | 20 requests         | 10s     |
| long     | 100 requests        | 60s     |

Además del rate limiter global, los siguientes endpoints tienen overrides específicos:

| Endpoint            | Límite       | Ventana |
|:--------------------|:-------------|:--------|
| `register`          | 5 requests   | 1 min   |
| `login`             | 5 requests   | 1 min   |
| `refresh`           | 10 requests  | 1 min   |
| `deleteUser`        | 5 requests   | 1 min   |
| `google`            | 5 requests   | 1 min   |
| `forgot-password`   | 3 requests   | 1 min   |
| `reset-password`    | 3 requests   | 1 min   |
| `verify-email`      | 5 requests   | 1 min   |

El endpoint `forgot-password` también tiene un **rate limit adicional por email** en Redis (1 request cada 5 minutos por dirección de correo), independiente del rate limit global.

---

## Seguridad HTTP

| Medida                     | Comportamiento                                                                 |
|:---------------------------|:-------------------------------------------------------------------------------|
| **Allow list de clientes** | `ALLOWED_CLIENTS` es obligatorio: el servicio **no arranca** si falta o está vacío. Todo `register`/`login`/`google` con un `client` fuera de la lista se rechaza con 401 |
| **Headers**                | `helmet` en todas las respuestas (incluye `X-Content-Type-Options`, `X-Frame-Options`, HSTS). `X-Powered-By` no se envía |
| **Límite de body**         | 100 KB por defecto, configurable con `BODY_LIMIT`. Un body mayor responde 413 |
| **CORS**                   | Deshabilitado salvo que definas `CORS_ORIGINS` (lista separada por comas); con valor, se habilita solo para esos orígenes |
| **Trust proxy**            | `TRUST_PROXY` configura Express para respetar `X-Forwarded-For` detrás de un proxy; crítico para que el rate limiting use la IP real del cliente |
| **Configuración JWT**      | El servicio falla al arrancar si falta `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` o `JWT_KID`, o si la clave pública no se puede publicar como JWKS |
| **Contraseñas**            | Nunca se devuelven: la entity excluye el campo y el serializer global lo omite |
| **Normalización de entrada** | Los emails se recortan y se pasan a minúsculas; los DTOs validan longitud y contenido antes de persistir |
| **Sesiones**               | `logout-all`, cambio de contraseña, reset y soft-delete incrementan `authVersion`, invalidando tokens y refresh tokens previos |
| **Google**                 | Solo se aceptan identidades con `email_verified` en el token de Google |

Los errores no esperados nunca exponen su mensaje interno: el filtro global responde 500 genérico, mientras que los errores de cliente (body demasiado grande, JSON malformado) conservan su status real (413/400).

---

## Quick Start

### 1. Stack de desarrollo (Docker Compose)

Levanta **solo** PostgreSQL y Redis; la API corre en el host con `pnpm start`. La imagen de la app es para desplegar (ver [Despliegue](#despliegue)).

```bash
# Clonar
git clone <repo-url> && cd api-auth
cp .env.example .env

# Generar claves RSA y pegarlas en .env
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
# Copiar contenido de private.pem a JWT_PRIVATE_KEY y public.pem a JWT_PUBLIC_KEY

# Base de datos y cache
docker compose -f docker-compose.dev.yml up -d

# Migraciones y API
pnpm install
pnpm migration:run
pnpm start
```

Si el shell exporta hostnames internos de Compose (por ejemplo `DB_HOST=db`), exportá `DB_HOST=localhost REDIS_HOST=localhost` antes de correr la app o las migraciones.

### 2. Manual (desarrollo local)

```bash
# Variables de entorno
cp .env.example .env
# Completar DB_*, REDIS_HOST, ALLOWED_CLIENTS y las claves RSA

# Dependencias
pnpm install

# Migraciones (requiere PostgreSQL corriendo)
pnpm migration:run

# Iniciar
pnpm dev
```

### Variables de Entorno

Las marcadas como **(requerida)** son validadas al arrancar: si faltan, el proceso no inicia.

```env
# Base de datos (requeridas)
DB_HOST=localhost        # (requerida)
DB_PORT=5432             # (requerida)
DB_USER=root             # (requerida)
DB_PASSWORD=password     # (requerida)
DB_NAME=auth             # (requerida)

# JWT RS256 (requeridas, contenido PEM completo)
JWT_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----
JWT_KID=my-key-id

# Redis (requerido: REDIS_HOST o REDIS_URL)
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_URL=redis://usuario:password@host:6379   # alternativa; usar rediss:// para TLS
# REDIS_PASSWORD=

# App
PORT=3000
NODE_ENV=development
ALLOWED_CLIENTS=web,mobile   # (requerida) clientes habilitados, separados por coma
# CORS_ORIGINS=https://app.example.com,https://admin.example.com
# BODY_LIMIT=100kb
# TRUST_PROXY=1              # respeta X-Forwarded-For detrás de un proxy

# Mail Service
MAIL_SERVICE_URL=http://mail:8080
# MAIL_SERVICE_TIMEOUT=90000

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxx
```

---

## Estructura del Proyecto

```
src/
├── auth/                  # Módulo de autenticación
│   ├── auth.controller.ts    # register, login, refresh, logout, logout-all, verify/resend-email, change-password, deleteUser, forgot/reset-password, google
│   ├── auth.service.ts       # Lógica de negocio + refresh tokens + reuse detection + verificación email + authVersion
│   ├── jwks.service.ts       # Construye el JWKS una vez al arrancar (fail-fast)
│   ├── well-known.controller.ts  # GET /.well-known/jwks.json
│   ├── guard/auth.guard.ts   # Validación JWT + blacklist Redis + authVersion
│   ├── decorators/           # @GetUser() decorator
│   ├── dto/                  # register, login, forgot-password, reset-password, refresh-token, verify-email, google-login, resend-verification, change-password
│   └── constants/            # JwtConfigService (claves PEM) + TTLs del cache
├── users/                 # Módulo de usuarios
│   ├── users.controller.ts   # CRUD protegido (paginado, aislado por cliente) + me (GET/PATCH)
│   ├── users.service.ts      # find, remove (soft-delete), restore, update
│   ├── dto/                  # pagination, create-user, update-user, update-me
│   └── entities/user.entity.ts  # TypeORM entity (provider, emailVerifiedAt, authVersion, índice client+email, soft-delete)
├── mail/                  # Cliente HTTP para Mail Service externo
│   ├── mail-client.module.ts
│   └── mail-client.service.ts  # sendPasswordResetEmail, sendVerificationEmail
├── config/                # validateEnv (validación de entorno al arrancar) + redis-connection + redis-throttler-storage
├── migrations/            # Migraciones TypeORM
│   ├── 1758608433133-InitialSchema.ts
│   ├── 1758608433134-FixDaletedAtTypo.ts
│   ├── 1758608433135-AddProviderAndNullablePassword.ts
│   ├── 1758608433136-AddEmailVerifiedAt.ts
│   ├── 1758608433137-AddClientEmailIndex.ts
│   └── 1758610000000-AddAuthVersion.ts
├── middleware/             # CorrelationIdMiddleware
├── request-context/       # AsyncLocalStorage wrapper
├── logger/                # CustomLogger con correlation ID
├── interceptors/          # LoggingInterceptor
├── filters/               # AllExceptionsFilter (global)
├── health/                # HealthController (Terminus) + RedisHealthIndicator
├── app.setup.ts           # helmet, CORS, límite de body, trust proxy, pipes y prefijo global
└── interfaces/            # JwtPayload interface
```

---

## Decisiones Técnicas

| Decisión                     | Alternativa       | Por qué                                                                 |
|:-----------------------------|:------------------|:------------------------------------------------------------------------|
| **RS256** (asimétrico)       | HS256 (simétrico) | Los servicios de negocio verifican sin compartir secreto; rotación de claves posible vía JWKS |
| **AuthN separado de AuthZ**  | Todo en uno       | Este servicio solo identifica; permisos y roles son dominio del negocio |
| **TypeORM migraciones**      | `synchronize: true` | Control de cambios en DB, rollbacks, revisión en código                |
| **AsyncLocalStorage**        | Request-scoped DI | Contexto implícito sin acoplar firmas de métodos                        |
| **Redis blacklist (jti)**    | Blacklist en DB   | O(1) en memoria, TTL automático, no satura la DB                        |
| **cache-manager + Keyv**     | ioredis directo   | Abstracción intercambiable; `@keyv/redis` es el adapter mantenido para cache-manager 7 |
| **Refresh token rotativo**   | Refresh token fijo | Invalida el token anterior al usarlo y revoca la familia completa si se detecta reuso |
| **Callback URL agnóstico**   | Frontend URL fijo | Cada proyecto decide su propia URL de reset/verificación; el auth service solo envía el mail |
| **Mail service externo**     | Mailer embebido   | El auth service no envía emails directamente; delega en un servicio Go independiente |

---

## Tests

```bash
# Tests unitarios
pnpm test

# Tests e2e (requiere el stack de docker-compose.dev.yml levantado y migrado)
pnpm test:e2e

# Cobertura
pnpm test:cov
```

Los e2e solo mockean el envío de mails: el resto corre contra PostgreSQL y Redis reales, incluyendo verificación de email, rotación de refresh tokens, revocación por logout y aislamiento entre clientes.

---

## Despliegue

El `Dockerfile` usa build multi-stage con `pnpm` para minimizar la imagen final. El `docker-entrypoint.sh` espera a que la base acepte conexiones, corre las migraciones pendientes y recién ahí inicia la app (corre como usuario no root).

```bash
# Build manual
docker build -t api-auth .
```

Variables propias del entrypoint:

| Variable             | Default | Descripción                                                        |
|:---------------------|:--------|:--------------------------------------------------------------------|
| `RUN_MIGRATIONS`     | `true`  | Aplica migraciones antes de arrancar. En Swarm con varias réplicas, dejar `true` en una sola task (o en una task de migración) y `false` en el resto, para evitar carreras |
| `DB_WAIT_ATTEMPTS`   | `60`    | Intentos de espera de la base antes de abortar (uno cada 2s)        |

En Swarm, el servicio necesita `DB_*`, `REDIS_HOST`/`REDIS_URL`, `ALLOWED_CLIENTS` y las claves `JWT_*`. Como las claves se leen desde variables de entorno, si preferís Docker secrets (archivos) exportá su contenido al arrancar la task o pasalas como variables del servicio.
