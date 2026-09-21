import { Controller, Get } from '@nestjs/common';
import { JwksService } from './jwks.service';

@Controller()
export class WellKnownController {
  constructor(private readonly jwksService: JwksService) {}

  @Get('.well-known/jwks.json')
  getJwks() {
    return this.jwksService.getDocument();
  }
}
