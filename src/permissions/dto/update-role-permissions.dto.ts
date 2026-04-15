import { ArrayNotEmpty, IsArray, IsNumberString } from 'class-validator';

export class UpdateRolePermissionsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsNumberString({}, { each: true })
  permissionIds: string[];
}
