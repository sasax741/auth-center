import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthGuard } from '../auth/guard/auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { PaginationDto } from './dto/pagination.dto';
import { UpdateMeDto } from './dto/update-me.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(AuthGuard)
  me(@GetUser() user: JwtPayload) {
    return this.usersService.findOne(user.sub);
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  updateMe(@GetUser() user: JwtPayload, @Body() updateMeDto: UpdateMeDto) {
    return this.usersService.update(user.sub, updateMeDto);
  }

  @Get()
  @UseGuards(AuthGuard)
  async findAll(
    @GetUser() user: JwtPayload,
    @Query() pagination: PaginationDto,
  ) {
    const [items, total] = await Promise.all([
      this.usersService.findAll(user.aud, pagination.page, pagination.limit),
      this.usersService.count(user.aud),
    ]);

    return {
      items,
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  findOne(@Param('id', ParseIntPipe) id: number, @GetUser() user: JwtPayload) {
    return this.usersService.findOne(id, user.aud);
  }
}
