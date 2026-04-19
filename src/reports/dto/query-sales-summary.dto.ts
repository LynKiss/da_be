import { IsDateString, IsOptional } from 'class-validator';

export class QuerySalesSummaryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
