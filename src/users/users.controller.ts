import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthGuard } from '../auth/guard/auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { PaginationDto } from './dto/pagination.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @UseGuards(AuthGuard)
  findAll(@GetUser() user: JwtPayload, @Query() pagination: PaginationDto) {
    return this.usersService.findAll(
      user.aud,
      pagination.page,
      pagination.limit,
    );
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  findOne(@Param('id', ParseIntPipe) id: number, @GetUser() user: JwtPayload) {
    return this.usersService.findOne(id, user.aud);
  }
}
