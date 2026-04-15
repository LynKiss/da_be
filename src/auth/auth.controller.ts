import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  Public,
  ResponseMessage,
  User as CurrentUser,
} from '../decorator/customize';
import { RegisterUserDto } from '../users/dto/create-user.dto';
import type { IUser } from '../users/users.interface';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './local-auth.guard';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('/auth/login')
  @ResponseMessage('User Login')
  handleLogin(
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.login(req.user as IUser, response);
  }

  @Public()
  @Get('/auth/refresh')
  @ResponseMessage('Get new access token by refresh token')
  refresh(@Req() req: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = req.cookies?.refresh_token as string | undefined;
    return this.authService.refreshToken(refreshToken, response);
  }

  @Public()
  @Post('/auth/register')
  @ResponseMessage('Register a new user')
  register(@Body() registerUserDto: RegisterUserDto) {
    return this.authService.register(registerUserDto);
  }

  @Post('/auth/logout')
  @ResponseMessage('User Logout')
  logout(
    @CurrentUser() user: IUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.logout(user, response);
  }

  @Get('/auth/account')
  @ResponseMessage('Get user information')
  getAccount(@CurrentUser() user: IUser) {
    return { user };
  }
}
