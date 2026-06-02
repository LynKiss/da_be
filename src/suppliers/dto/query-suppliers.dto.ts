import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QuerySuppliersDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['all', 'active', 'inactive'])
  status?: 'all' | 'active' | 'inactive';

  @IsOptional()
  @IsIn(['all', 'outstanding', 'near_limit', 'over_limit'])
  debtStatus?: 'all' | 'outstanding' | 'near_limit' | 'over_limit';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
