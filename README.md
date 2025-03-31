<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="200" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://coveralls.io/github/nestjs/nest?branch=master" target="_blank"><img src="https://coveralls.io/repos/github/nestjs/nest/badge.svg?branch=master#9" alt="Coverage" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->


# Integración de la App de Negocio con el Microservicio de Autenticación

Esta documentación describe el flujo de integración entre el microservicio de autenticación y la aplicación de negocio. Se detalla cómo se utilizan los tokens JWT, la verificación de seguridad (incluyendo la comprobación en una lista de tokens revocados almacenada en Redis) y el manejo de roles dentro de la aplicación de negocio.

## Componentes Clave

- **Microservicio de Autenticación**
  - Emite tokens JWT al registrar o iniciar sesión.
  - Genera un payload con los siguientes campos:
    - `aud` (Audience): Destinatario del token.
    - `exp` (Expiration Time): Momento de expiración.
    - `iat` (Issued At): Momento en que se emitió.
    - `iss` (Issuer): Emisor del token.
    - `jti` (JWT ID): Identificador único para prevenir ataques de replay.
    - `nbf` (Not Before): Tiempo a partir del cual el token es válido.
    - `sub` (Subject): Identificador del usuario.

- **Aplicación de Negocio (Cliente)**
  - Recibe y utiliza el token para autenticar al usuario.
  - Verifica:
    - La firma y validez temporal del token (`iat`, `nbf` y `exp`).
    - Que el token esté destinado a ella (comprobación del `aud`).
    - Que el `jti` no figure en la lista de tokens revocados.
  - Usa el campo `sub` para identificar al usuario y, con ello, consultar la base de datos de roles y permisos para aplicar la lógica de negocio.

- **Lista de Tokens Revocados (Redis)**
  - Se utiliza para almacenar los `jti` de los tokens que han sido revocados (por ejemplo, tras un logout o cuando se detecta uso sospechoso).
  - La aplicación de negocio, o un microservicio dedicado, consulta Redis para confirmar que el token recibido no esté revocado.

## Flujo de Integración

1. **Autenticación y Emisión del Token**
   - El usuario se registra o inicia sesión en el microservicio de autenticación.
   - Se genera un token JWT que incluye los campos mencionados.
   - El token se envía a la aplicación de negocio.

2. **Validación del Token en la App de Negocio**
   - **Verificación de Firma y Tiempos:**
     La app valida la firma del token, comprueba que no haya expirado (`exp`), que se encuentre dentro de la ventana de validez (`iat` y `nbf`).
   - **Verificación del Destinatario:**
     Se comprueba que el `aud` del token coincida con la app de negocio.
   - **Verificación del Token Revocado:**
     La aplicación consulta el servicio (basado en Redis) para asegurarse de que el `jti` no esté en la lista negra.
   - **Identificación del Usuario:**
     Se extrae el `sub` para identificar al usuario y se consulta la base de datos local para obtener sus roles y permisos.

3. **Manejo de Roles y Permisos**
   - Con el identificador del usuario (`sub`), la aplicación de negocio consulta su propia base de datos para determinar los roles asignados.
   - Con base en los roles y permisos, la aplicación decide qué acciones puede realizar el usuario.

## Diagrama de Flujo

El siguiente diagrama ilustra la interacción entre los componentes:

```mermaid
flowchart TD
    A[Usuario] -->|Se registra/inicia sesión| B(Microservicio de Autenticación)
    B -->|Emite JWT con payload: aud, exp, iat, iss, jti, nbf, sub| C(App de Negocio)
    C --> D{Valida Token}
    D -->|Verifica firma, tiempos, aud y Consulta Redis: lista negra jti| E[Token Válido]
    D --> F[Token Revocado]
    E --> G[Extrae sub y consulta roles]
    G --> H[Base de Datos de Roles]
    H --> I[Aplica lógica de negocio]
    F --> J[Rechaza acceso]
```


## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Installation

```bash
$ npm install
```

## Running the app

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Test

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## ENV

Para Levantar el projecto es necesario crear el ENV. Example:

```bash
#DATABASE
DB_HOST=localhost
DB_PORT=5432
DB_USER=root
DB_PASSWORD=password
DB_NAME=auth

#TOKEN
JWT_SECRET=w4v3s

#APP
PORT=3000
