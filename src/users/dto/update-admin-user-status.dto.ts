import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateAdminUserStatusDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
