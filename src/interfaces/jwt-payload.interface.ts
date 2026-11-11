export interface JwtPayload {
  aud: string; // Audience: Especifica quién es el destinatario del token.
  exp: number; // Expiration Time: Indica el tiempo en el que el token expirará (timestamp en segundos).
  iat: number; // Issued At: Muestra el momento en que el token fue emitido (timestamp en segundos).
  iss: string; // Issuer: Identifica al emisor del token (URL o identificador único).
  jti: string; // JWT ID: Un identificador único para el token, útil para evitar ataques de replay.
  nbf: number; // Not Before: Define el tiempo antes del cual el token no es válido (timestamp).
  sub: number; // Subject: Representa al sujeto del token (ID del usuario o entidad).
  authVersion: number; // Versión de sesión: se incrementa al revocar sesiones (reset password, delete).
}
