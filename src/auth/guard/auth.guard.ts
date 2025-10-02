import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { JwtConfigService } from '../constants/jwt-config.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { JwtPayload } from 'src/interfaces/jwt-payload.interface';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly jwtService: JwtService,
    private readonly jwtConfigService: JwtConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('The token is non-existent');
    }

    try {
      const payload: JwtPayload = await this.jwtService.verifyAsync(token, {
        publicKey: this.jwtConfigService.publicKey,
        algorithms: ['RS256'],
      });

      const isRevoked = await this.cacheManager.get(payload.jti);
      if (isRevoked) {
        throw new UnauthorizedException('Token has been revoked');
      }

      request['user'] = payload;
    } catch (e) {
      throw new UnauthorizedException(e.message || 'Unknown token error');
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
