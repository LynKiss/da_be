import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CalcPriceSuggestionDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  grId?: string;

  @IsNumber()
  @Min(0)
  landedCost!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  wastePct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  sellingCostPct?: number;

  @IsNumber()
  @Min(0)
  @Max(1000)
  profitPct!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  bulkDiscountPct?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  unitPerBulk?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ApplyPriceDto {
  @IsNumber()
  @Min(0)
  retailPrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bulkPrice?: number;
}
