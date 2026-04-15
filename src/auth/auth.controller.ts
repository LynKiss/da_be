// Body/Controller/Get/Post/... la cac decorator route cua NestJS.
import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';

// AuthService chua nghiep vu login, register, refresh, logout.
import { AuthService } from './auth.service';

// LocalAuthGuard dung passport-local de xac thuc username/password.
import { LocalAuthGuard } from './local-auth.guard';

import {

  Public,

  ResponseMessage,

  User as CurrentUser,

} from '../decorator/customize';

// DTO dang ky tai khoan.
import { RegisterUserDto } from '../users/dto/create-user.dto';

// Interface user dung xuyen suot app.
import { IUser } from '../users/users.interface';
// Request/Response cua express.
import { Request, Response } from 'express';
// RolesService dung de load full permissions cho route /auth/account.
import { RolesService } from '../roles/roles.service';
import { ThrottlerGuard } from '@nestjs/throttler';



// Controller auth chua cac route lien quan den xac thuc.
@Controller()

export class AuthController {

  // Inject service auth va role.
  constructor(
    private authService: AuthService,
    private rolesService: RolesService,
  ) { }



  // Login la route public vi user chua co token o buoc nay.
  // LocalAuthGuard se validate username/password truoc khi vao handler.

  @Public()

  @UseGuards(LocalAuthGuard)
  @UseGuards(ThrottlerGuard)

  @Post('/auth/login')

  @ResponseMessage('User Login')

  handleLogin(
    // req.user se duoc gan boi LocalStrategy sau khi validate thanh cong.
    @Req() req: Request,
    // passthrough=true cho phep vua set cookie vua van tra JSON body.
    @Res({ passthrough: true }) response: Response,
  ) {

    return this.authService.login(req.user as IUser, response);

  }



  // Route refresh la public vi access token co the da het han.
  @Public()

  @Get('/auth/refresh')

  @ResponseMessage('Get new access token by refresh token')

  refresh(
    // req dung de doc cookie refresh_token.
    @Req() req: Request,
    // response dung de set lai cookie refresh token moi.
    @Res({ passthrough: true }) response: Response,
  ) {
    // Lay refresh token tu cookie do backend da set luc login.
    const refreshToken = req.cookies?.refresh_token;

    return this.authService.refreshToken(refreshToken, response);

  }



  // Route dang ky tai khoan moi.
  @Public()

  @Post('/auth/register')

  @ResponseMessage('Register a new user')

  register(
    // Body dang ky duoc validate boi DTO.
    @Body() registerUserDto: RegisterUserDto,
  ) {

    return this.authService.register(registerUserDto);

  }



  // Route logout yeu cau user da dang nhap.
  @Post('/auth/logout')

  @ResponseMessage('User Logout')

  logout(
    // CurrentUser lay req.user tu custom decorator.
    @CurrentUser() user: IUser,
    // Response dung de clear cookie refresh token.
    @Res({ passthrough: true }) response: Response,
  ) {

    return this.authService.logout(user, response);

  }



  // Route nay dung de FE goi lai thong tin account hien tai sau khi F5.

  @Get('/auth/account')

  @ResponseMessage('Get user information')

  async getAccount(@Req() req: Request) {
    // req.user duoc gan boi JwtStrategy sau khi access token hop le.
    const user = req.user as IUser;

    // JWT payload chi chua role tom tat, nen can query them role de lay full permissions.
    if (user?.role?._id) {
      const role = await this.rolesService.findOne(user.role._id);
      user.permissions =
        role?.permissions?.map((permission: any) => ({
          _id: permission._id?.toString?.() ?? permission._id,
          name: permission.name,
          apiPath: permission.apiPath,
          method: permission.method,
          module: permission.module,
        })) ?? [];
    }

    // Tra ve user sau khi da bo sung permissions.
    return {

      user,

    };

  }

}
