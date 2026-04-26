import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ToBoolean } from '../../common/dto-transformers';

export class QueryReorderSuggestionsDto {
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
  leadTimeDays?: number = 7;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  coverageDays?: number = 30;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 50;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeAll?: boolean = false;
}
