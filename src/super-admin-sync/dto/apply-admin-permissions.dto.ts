import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApplyAdminPermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissionKeys!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  syncedBy?: string;
}
