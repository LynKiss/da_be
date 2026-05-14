import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP phai gom 6 chu so' })
  otp: string;

  @IsString()
  @MinLength(6)
  @MaxLength(64)
  newPassword: string;
}
