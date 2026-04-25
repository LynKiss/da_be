import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReturnInspectionStatus } from '../entities/return.entity';

export class InspectReturnDto {
  @IsEnum(ReturnInspectionStatus)
  decision: ReturnInspectionStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
