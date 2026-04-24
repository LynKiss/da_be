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

export class CreateGrItemDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  unitPerBase?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  qtyOrdered?: number;

  @IsInt()
  @Min(0)
  qtyReceived!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  qtyDefective?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  qtyReturned?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  refundAmount?: number;

  @IsOptional()
  @IsBoolean()
  hasRefund?: boolean;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateGrDto {
  @IsOptional()
  @IsString()
  poId?: string;

  @IsString()
  supplierId!: string;

  @IsDateString()
  receiptDate!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  otherCost?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGrItemDto)
  items!: CreateGrItemDto[];
}
