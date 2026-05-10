# API Auth — Microservicio de Autenticación

Microservicio de autenticación construido con NestJS que emite tokens JWT firmados con **RS256** (firma asimétrica). Se encarga exclusivamente de **AuthN** (verificar quién es el usuario); la **AuthZ** (qué puede hacer) queda en manos de los servicios de negocio.

---

## Stack Tecnológico

| Componente   | Tecnología                                |
|-------------|-------------------------------------------|
| Framework   | NestJS + TypeScript                       |
| Base de datos | PostgreSQL 16 + TypeORM (migraciones)   |
| Cache / Blacklist | Redis 7                          |
| JWT         | RS256 (claves RSA de 2048 bits)           |
| Contenedores | Docker + docker-compose                  |
| Rate Limiting | @nestjs/throttler (3 niveles)           |
| Tracing     | Correlation ID + AsyncLocalStorage        |

---

## Arquitectura

```mermaid
C4Context
    title System Context — API Auth

    Person(client, "Client", "Web / Mobile app que consume endpoints de auth")

    System_Boundary(auth, "API Auth Service") {
        Container(api, "NestJS App", "Node.js, TypeScript", "AuthN: register, login, logout, JWKS")
        ContainerDb(pg, "PostgreSQL", "TypeORM", "Almacena usuarios (name, email, password hash, client)")
        ContainerDb(redis, "Redis", "cache-manager", "Blacklist de tokens (jti revocados)")
    }

    System_Ext(business, "External Microservices", "Servicios de negocio que consumen JWKS para validar tokens")

    Rel(client, api, "HTTP /api/v1/auth/*", "HTTPS")
    Rel(api, pg, "TypeORM", "SQL")
    Rel(api, redis, "ioredis", "Cache protocol")
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
| `POST`  | `/auth/register`                 | Registra un nuevo usuario                                                   | No   | 5 req/min      |
| `POST`  | `/auth/login`                    | Autentica y devuelve un JWT RS256                                           | No   | 5 req/min      |
| `POST`  | `/auth/logout`                   | Revoca el token actual (agrega jti a Redis blacklist)                       | Sí   | Global         |
| `DELETE`| `/auth/deleteUser/:id`           | Soft-delete de usuario (solo el propio dueño)                               | Sí   | Global         |
| `GET`   | `/users`                         | Lista todos los usuarios                                                    | Sí   | Global         |
| `GET`   | `/users/:id`                     | Obtiene un usuario por ID                                                   | Sí   | Global         |
| `GET`   | `/health`                        | Health check con ping a PostgreSQL                                          | No   | Global         |
| `GET`   | `/.well-known/jwks.json`         | Clave pública en formato JWKS (ruta absoluta, sin prefijo)                  | No   | Global         |

---

## Flujos de Autenticación

```mermaid
sequenceDiagram
    participant C as Client
    participant API as API Auth (NestJS)
    participant PG as PostgreSQL
    participant R as Redis

    Note over C,R: REGISTER
    C->>API: POST /api/v1/auth/register
    API->>API: Validar DTO (name, email, password, client)
    API->>PG: Verificar email único
    API->>API: Hash password (bcrypt, 10 rounds)
    API->>PG: INSERT user (transaction)
    PG-->>API: User saved
    API-->>C: 201 { id, name, email, client }

    Note over C,R: LOGIN
    C->>API: POST /api/v1/auth/login
    API->>PG: Buscar usuario por email
    PG-->>API: User data (password hash)
    API->>API: Comparar bcrypt hash
    API->>API: Firmar JWT RS256 { sub, aud, jti, iss, exp, nbf }
    API-->>C: 200 { email, token }

    Note over C,R: LOGOUT
    C->>API: POST /api/v1/auth/logout (Bearer JWT)
    API->>API: AuthGuard — verificar firma JWT
    API->>API: Extraer jti + exp del payload
    API->>R: SET jti → "revoked" (TTL = exp - now)
    R-->>API: OK
    API-->>C: 200 { message: "Logout successful" }
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
    Blacklist -->|jti no encontrado| Allow[Permitir request<br>→ Controller]

    DenyExp --> Response[Respuesta JSON error]
    DenyRev --> Response

    style Allow fill:#b2f2bb,stroke:#2f9e44,color:#2f9e44
    style DenyExp fill:#ffc9c9,stroke:#e03131,color:#e03131
    style DenyRev fill:#ffc9c9,stroke:#e03131,color:#e03131
    style Verify fill:#ffec99,stroke:#e67700,color:#e67700
    style Expired fill:#ffec99,stroke:#e67700,color:#e67700
    style Blacklist fill:#ffec99,stroke:#e67700,color:#e67700
```

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

Tres niveles configurados globalmente:

| Nivel    | Límite              | Ventana |
|:---------|:--------------------|:--------|
| short    | 3 requests          | 1s      |
| medium   | 20 requests         | 10s     |
| long     | 100 requests        | 60s     |

Los endpoints `register` y `login` tienen un override específico: **5 requests por minuto**.

---

## Quick Start

### 1. Docker Compose (recomendado)

```bash
# Clonar e iniciar
git clone <repo-url> && cd api-auth
cp .env.example .env

# Generar claves RSA y pegarlas en .env
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
# Copiar contenido de private.pem a JWT_PRIVATE_KEY y public.pem a JWT_PUBLIC_KEY

# Levantar todo (PostgreSQL + Redis + API)
docker-compose up -d
```

El entrypoint de Docker corre las migraciones automáticamente antes de iniciar la app.

### 2. Manual (desarrollo local)

```bash
# Variables de entorno
cp .env.example .env
# Configurar DB_HOST=localhost, REDIS_HOST=localhost y las claves RSA

# Dependencias
npm install

# Migraciones (requiere PostgreSQL corriendo)
npx ts-node datasource.ts
npx typeorm-ts-node-commonjs migration:run --dataSource datasource.ts

# Iniciar
npm run start:dev
```

### Variables de Entorno

```env
# Base de datos
DB_HOST=localhost
DB_PORT=5432
DB_USER=root
DB_PASSWORD=password
DB_NAME=auth

# JWT RS256 (contenido PEM completo)
JWT_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----
JWT_KID=my-key-id

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# App
PORT=3000
NODE_ENV=development
```

---

## Estructura del Proyecto

```
src/
├── auth/                  # Módulo de autenticación
│   ├── auth.controller.ts    # register, login, logout, deleteUser
│   ├── auth.service.ts       # Lógica de negocio + transacciones
│   ├── well-known.controller.ts  # GET /.well-known/jwks.json
│   ├── guard/auth.guard.ts   # Validación JWT + blacklist Redis
│   ├── decorators/           # @GetUser() decorator
│   ├── dto/                  # register.dto, login.dto
│   └── constants/            # JwtConfigService (carga claves PEM)
├── users/                 # Módulo de usuarios
│   ├── users.controller.ts   # CRUD protegido
│   ├── users.service.ts      # find, remove (soft-delete)
│   └── entities/user.entity.ts  # TypeORM entity
├── migrations/            # Migraciones TypeORM
│   ├── 1758608433133-InitialSchema.ts
│   └── 1758608433134-FixDaletedAtTypo.ts
├── middleware/             # CorrelationIdMiddleware
├── request-context/       # AsyncLocalStorage wrapper
├── logger/                # CustomLogger con correlation ID
├── interceptors/          # LoggingInterceptor
├── filters/               # AllExceptionsFilter (global)
├── health/                # HealthController (Terminus)
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
| **cache-manager**            | ioredis directo   | Abstracción intercambiable (Redis → Memcached sin cambiar código)       |

---

## Tests

```bash
# Tests unitarios
npm run test

# Tests e2e
npm run test:e2e

# Cobertura
npm run test:cov
```

---

## Despliegue

El `Dockerfile` usa build multi-stage con `pnpm` para minimizar la imagen final. El `docker-entrypoint.sh` ejecuta las migraciones antes de iniciar la app.

```bash
# Build manual
docker build -t api-auth .
```
