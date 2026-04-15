import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @IsNotEmpty({
    message: 'Refresh token khong duoc de trong',
  })
  @IsString()
  refreshToken: string;
}
