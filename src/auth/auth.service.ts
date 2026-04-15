// Response cua express duoc dung de set/clear cookie tren trinh duyet.
import { Response } from 'express';



// Thu vien ms giup doi chuoi duration nhu "300s" thanh milliseconds.
import ms = require('ms');



// ConfigService doc secret va expires tu file .env.
import { ConfigService } from '@nestjs/config';



// UsersService chua nghiep vu truy van user va update refresh token.
import { UsersService } from '../users/users.service';
// RolesService chua nghiep vu lay full role + permissions.
import { RolesService } from '../roles/roles.service';



// Injectable de Nest inject service nay.
// UnauthorizedException dung cho cac truong hop token khong hop le.
import { Injectable, UnauthorizedException } from '@nestjs/common';



// JwtService chua cac ham sign/verify JWT.
import { JwtService } from '@nestjs/jwt';



// IUser la interface thong nhat cho thong tin user dang dang nhap.
import { IUser } from '../users/users.interface';



// DTO dung cho route dang ky user moi.
import { RegisterUserDto } from '../users/dto/create-user.dto';



// StringValue la type cua chuoi duration hop le cho ms.
import { StringValue } from 'ms';



// AuthService chua toan bo logic login/register/refresh/logout.
 @Injectable()

export class AuthService {

  // Constructor inject cac dependency can cho auth.
  constructor(

    // usersService de tim user, compare password va luu refresh token hash.
    private usersService: UsersService,



    // jwtService de ky access token va refresh token.
    private jwtService: JwtService,



    // configService de doc secret va thoi gian het han tu .env.
    private configService: ConfigService,

    // rolesService de lay permissions day du nhat theo role.
    private rolesService: RolesService,

  ) { }



  // Ham nay duoc LocalStrategy goi khi user dang nhap bang username/password.
  async validateUser(username: string, pass: string): Promise<any> {

    // Tim user theo email dang nhap.
    const user = await this.usersService.findOneByUsername(username);



    // So khop password plain text voi hash trong DB.
    const isPasswordValid = user

      ? this.usersService.checkUserPassword(pass, user.password)

      : false;



    // Log de debug login flow.
    console.log('[Auth] validateUser', {

      username,



      foundUser: !!user,



      isPasswordValid,

    });



    // Sai username hoac password thi tra null de passport tu xu ly 401.
    if (!user || !isPasswordValid) {

      return null;

    }



    // Loai bo password khoi object tra ve.
    const { password, ...result } = user.toObject();



    return {

      ...result,



      // Chuan hoa _id thanh string som de cac buoc ky JWT va update DB on dinh hon.



      _id: user._id.toString(),

    };

  }



  // Ham nay trich xuat permissions tu role neu role da duoc populate day du.
  // Neu role khong co permissions thi tra ve mang rong.

  private extractPermissionsFromRole(role: any) {
    if (
      role &&
      typeof role === 'object' &&
      Array.isArray((role as any).permissions)
    ) {
      return (role as any).permissions;
    }

    return [];
  }

  // Chuan hoa danh sach permissions ve shape ma FE dang su dung.
  private normalizePermissions(permissions: any[] = []) {
    return permissions.map((permission: any) => ({
      _id: permission._id?.toString?.() ?? permission._id,
      name: permission.name,
      apiPath: permission.apiPath,
      method: permission.method,
      module: permission.module,
    }));
  }

  // Luon query role tu DB de lay permissions moi nhat va day du.
  private async loadPermissionsForRole(role: IUser['role']) {
    if (!role?._id) {
      return [];
    }

    const fullRole = await this.rolesService.findOne(role._id);
    return this.normalizePermissions(fullRole?.permissions as any[]);
  }

  // Chuan hoa role mongoose ve shape { _id, name } cua IUser.
  private normalizeRole(role: any): IUser['role'] {
    return {
      _id: role?._id?.toString?.() ?? '',
      name: role?.name ?? '',
    };
  }



  // Tao payload dung chung cho access token va refresh token.
  private buildTokenPayload(user: IUser) {

    // Lay cac field can dua vao payload JWT.
    const { name, email, role } = user;

    // Chuan hoa role truoc khi dua vao token.
    const normalizedRole = this.normalizeRole(role);



    return {

      sub: 'token login',



      iss: 'from server',



      _id: user._id.toString(),



      name,



      email,



      role: normalizedRole,

    };

  }



  // Lay refresh token secret tu .env.
  private getRefreshTokenSecret() {

    return this.configService.get<string>('JWT_REFRESH_TOKEN') ?? '';

  }



  // Lay access token expires tu .env.
  private getAccessTokenExpires() {

    return (

      (this.configService.get<string>('JWT__ACCESS_EXPIRED') as

        | StringValue

        | undefined) ?? '300s'

    );

  }



  // Lay refresh token expires tu .env.
  private getRefreshTokenExpires() {

    return (

      (this.configService.get<string>('JWT_REFRESH_EXPIRED') as

        | StringValue

        | undefined) ?? '6000s'

    );

  }



  // FE thuong can seconds de hien thi countdown, trong khi ms() tra ve milliseconds.



  private toExpiresInSeconds(duration: StringValue) {

    return Math.floor(ms(duration) / 1000);

  }



  // Cookie maxAge can tinh theo milliseconds, khac voi expires_in tra ve cho FE la seconds.



  // Set refresh token vao cookie httpOnly de client JS khong doc truc tiep duoc.
  private setRefreshTokenCookie(response: Response, refreshToken: string) {

    response.cookie('refresh_token', refreshToken, {

      httpOnly: true,

      sameSite: 'lax',

      maxAge: ms(this.getRefreshTokenExpires()),

    });

  }

  // Xoa cookie refresh token khi logout.
  private clearRefreshTokenCookie(response: Response) {
    response.clearCookie('refresh_token', {
      httpOnly: true,
      sameSite: 'lax',
    });
  }

  // Chuan hoa auth response chung cho login va refresh token.
  private buildAuthResponse(
    user: IUser,
    accessToken: string,
    permissions: IUser['permissions'] = [],
  ) {
    // Chuan hoa role de tranh truong hop role van la ObjectId.
    const normalizedRole = this.normalizeRole(user.role);

    return {
      access_token: accessToken,
      access_token_expires_in: this.toExpiresInSeconds(
        this.getAccessTokenExpires(),
      ),
      user: {
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: normalizedRole,
        permissions,
      },
    };
  }



  // Login sau khi LocalStrategy da validate thanh cong.
  async login(user: IUser, response?: Response) {

    // Chuan hoa _id user ve string.
    const _id = user._id.toString();



    const { name, email, role } = user;



    // Tao payload de ky JWT.
    const payload = this.buildTokenPayload(user);



    // Tao refresh token bang payload vua tao.
    const refresh_token = this.createRefreshToken(payload);



    // Set cookie neu controller truyen response vao.
    if (response) {

      this.setRefreshTokenCookie(response, refresh_token);

    }



    // Luu hash refresh token vao DB.
    await this.usersService.updateUserRefreshToken(_id, refresh_token);

    // Lay permissions moi nhat theo role de tra ve cho FE.
    const permissions = await this.loadPermissionsForRole(
      this.normalizeRole(user.role),
    );



    // Tra ve access token, refresh token va user info.
    return {
      ...this.buildAuthResponse(user, this.jwtService.sign(payload), permissions),
      refresh_token,
      refresh_token_expires_in: this.toExpiresInSeconds(
        this.getRefreshTokenExpires(),
      ),
    };

  }



  // Dang ky user moi, phan hash password + role USER da duoc xu ly trong UsersService.
  async register(registerUserDto: RegisterUserDto) {

    return this.usersService.register(registerUserDto);

  }



  // Refresh access token tu refresh token gui len tu cookie.
  async refreshToken(refreshToken: string | undefined, response: Response) {



    // Cookie khong co refresh token thi tu choi.
    if (!refreshToken) {

      throw new UnauthorizedException('Refresh token khong hop le');

    }



    // Verify refresh token bang secret rieng cua refresh token.
    const payload = this.jwtService.verify(refreshToken, {

      secret: this.getRefreshTokenSecret(),

    }) as IUser;



    // Tim user theo _id trong payload.
    const user = await this.usersService.findOneByIdForAuth(payload._id);



    // User khong ton tai hoac khong co refresh token hash thi token khong hop le.
    if (!user || !user.refreshToken) {

      throw new UnauthorizedException('Refresh token khong hop le');

    }



    // Compare refresh token plain text voi hash dang luu trong DB.
    const isRefreshTokenValid = this.usersService.checkUserPassword(

      refreshToken,



      user.refreshToken,

    );



    // Sai refresh token thi tra 401.
    if (!isRefreshTokenValid) {

      throw new UnauthorizedException('Refresh token khong hop le');

    }



    // Chuan hoa currentUser ve dung shape IUser.
    const currentUser: IUser = {

      _id: user._id.toString(),



      name: user.name,



      email: user.email,



      role: this.normalizeRole(user.role),

      permissions: this.extractPermissionsFromRole(user.role),

    };



    // Tao payload va refresh token moi.
    const newPayload = this.buildTokenPayload(currentUser);
    const newRefreshToken = this.createRefreshToken(newPayload);

    // Set lai cookie moi.
    this.setRefreshTokenCookie(response, newRefreshToken);
    // Luu hash refresh token moi vao DB.
    await this.usersService.updateUserRefreshToken(
      currentUser._id.toString(),
      newRefreshToken,
    );

    // Lay permissions moi nhat theo role hien tai.
    const permissions = await this.loadPermissionsForRole(currentUser.role);

    // Tra ve access token moi cho FE.
    return this.buildAuthResponse(
      currentUser,
      this.jwtService.sign(newPayload),
      permissions,
    );

  }



  // Logout: xoa refresh token trong DB va clear cookie tren trinh duyet.
  async logout(user: IUser, response: Response) {

    // Xoa refresh token hash trong DB.
    await this.usersService.updateUserRefreshToken(user._id.toString(), null);
    // Xoa cookie refresh token.
    this.clearRefreshTokenCookie(response);



    return {

      success: true,

    };

  }



  // Tao refresh token bang secret + expires cua refresh token.
  createRefreshToken = (

    payload: ReturnType<AuthService['buildTokenPayload']>,

  ) => {

    // Ky refresh token.
    const refresh_token = this.jwtService.sign(payload, {

      secret: this.getRefreshTokenSecret(),



      // Giữ nguyên string duration de tranh nham lan giữa seconds va milliseconds.



      expiresIn: this.getRefreshTokenExpires(),

    });



    return refresh_token;

  };

}
