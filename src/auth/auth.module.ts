// Module decorator de dinh nghia auth module trong NestJS.
import { Module } from '@nestjs/common';
// AuthService chua toan bo nghiep vu auth.
import { AuthService } from './auth.service';
// UsersModule export UsersService de AuthService co the inject.
import { UsersModule } from '../users/users.module';
// PassportModule bat middleware passport cho auth.
import { PassportModule } from '@nestjs/passport';
// LocalStrategy xu ly login bang username/password.
import { LocalStrategy } from './passport/local.strategy';
// JwtStrategy xu ly xac thuc route qua access token.
import { JwtStrategy } from './passport/jwt.strategy';
// JwtModule cung cap JwtService.
import { JwtModule } from '@nestjs/jwt';
// ConfigModule/ConfigService doc secret va expiresIn tu .env.
import { ConfigModule, ConfigService } from '@nestjs/config';
// StringValue la type cua chuoi duration hop le cho ms().
import { StringValue } from 'ms';
// ms dung de doi "300s" thanh milliseconds.
import ms = require('ms');
// AuthController chua cac route /auth/*.
import { AuthController } from './auth.controller';
// RolesModule export RolesService de auth co the load permissions theo role.
import { RolesModule } from '../roles/roles.module';

// Dinh nghia auth module.
@Module({
  imports: [
    // Import UsersModule de su dung UsersService.
    UsersModule,
    // Import RolesModule de su dung RolesService.
    RolesModule,
    // Bat cac tinh nang passport trong module auth.
    PassportModule,
    // Dang ky JwtModule theo kieu async de co the doc bien moi truong.
    JwtModule.registerAsync({
      // ConfigModule can duoc import de useFactory co ConfigService.
      imports: [ConfigModule],
      // Inject ConfigService vao factory.
      inject: [ConfigService],
      // Factory tao config cho JwtModule.
      useFactory: async (configService: ConfigService) => {
        // Doc expires cua access token tu .env.
        const jwtExpires =
          (configService.get<string>('JWT__ACCESS_EXPIRED') as
            | StringValue
            | undefined) ?? '60s';

        return {
          // Secret ky access token.
          secret: configService.get<string>('JWT__ACCESS_SECRET') ?? '',
          signOptions: {
            // ms() tra ve mili-giay, trong khi expiresIn dang number lai duoc hieu la giay.
            // Vi vay can doi tu ms sang seconds de tranh token song lau hon mong doi.
            expiresIn: Math.floor(ms(jwtExpires) / 1000),
          },
        };
      },
    }),
  ],
  // Cac provider auth can duoc Nest tao va inject.
  providers: [AuthService, LocalStrategy, JwtStrategy],
  // Export AuthService de module khac co the su dung neu can.
  exports: [AuthService],
  // Controller cua module auth.
  controllers: [AuthController],
})
export class AuthModule { }
