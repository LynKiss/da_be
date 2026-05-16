import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class QueryBatchesDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @Type(() => Boolean)
  includeDepleted?: boolean;
}

export class QueryExpiringDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  daysAhead?: number; // default 30
}

export class PreviewFifoDto {
  @IsString()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty!: number;
}

export class WriteOffBatchDto {
  @IsIn(['expired', 'damaged', 'quality_fail', 'other'])
  reason!: 'expired' | 'damaged' | 'quality_fail' | 'other';

  @IsOptional()
  @IsString()
  notes?: string;
}

export class PriceReductionDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  newUnitCost!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
