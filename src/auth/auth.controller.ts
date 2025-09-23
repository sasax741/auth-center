import { Body, Controller, Post, Delete, Param, UseGuards, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthGuard } from './guard/auth.guard';
import {JwtPayload} from '../interfaces/jwt-payload.interface';
import { GetUser } from './decorators/get-user.decorator';

@Controller('auth')
export class AuthController {

    constructor(
        private readonly authService: AuthService,
    ){}


    @Get(':id')
    @UseGuards(AuthGuard)
    getUser(
        @Param('id') id:number
    )
    {
        return this.authService.getUser(id);
    }

    @Get()
    @UseGuards(AuthGuard)
    getUsers()
    {
        return this.authService.getUsers();
    }

    @Post('register')
    register(
        @Body()
        registerDto: RegisterDto
    ){
        console.log(registerDto)
        return this.authService.register(registerDto);
    }

    @Post('login')
    login(
        @Body()
        loginDto: LoginDto
    ){
        return this.authService.login(loginDto);
    }

    @Post('logout')
    @UseGuards(AuthGuard)
    logout(@GetUser() user: JwtPayload) {
      return this.authService.logout(user);
    }
    
    @Delete('deleteUser/:id')
    @UseGuards(AuthGuard)
    deleteUser(
        @Param('id') id: number,
        @GetUser() user: JwtPayload
    ){
        return this.authService.deleteUser(id, user);
    }

}
