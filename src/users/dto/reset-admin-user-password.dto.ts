import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetAdminUserPasswordDto {
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  newPassword: string;
}
