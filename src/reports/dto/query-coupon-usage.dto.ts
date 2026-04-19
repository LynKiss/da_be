import { Type } from 'class-transformer';
import { IsDateString, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryCouponUsageDto {
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  discountId?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}
