import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateSrItemDto {
  @IsString()
  productId!: string;

  @IsInt()
  @Min(1)
  qtyReturned!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsBoolean()
  hasRefund?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  refundAmount?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateSrDto {
  @IsOptional()
  @IsString()
  grId?: string;

  @IsString()
  supplierId!: string;

  @IsDateString()
  returnDate!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSrItemDto)
  items!: CreateSrItemDto[];
}
