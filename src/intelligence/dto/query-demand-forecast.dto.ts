import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryDemandForecastDto {
  @IsString()
  productId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(14)
  @Max(365)
  historyDays?: number = 90;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  horizonDays?: number = 30;
}
