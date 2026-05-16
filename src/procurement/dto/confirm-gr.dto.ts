import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Một batch split do admin nhập khi confirm GR.
 * Cho phép chia 1 GR item thành nhiều lô (vd: 50kg HSD 2026-01 + 50kg HSD 2026-06).
 */
export class GrItemBatchDto {
  @IsString()
  batchCode!: string;

  @IsInt()
  @Min(1)
  qty!: number;

  @IsOptional()
  @IsDateString()
  mfgDate?: string;

  @IsOptional()
  @IsDateString()
  expDate?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

/**
 * Mapping batch splits cho 1 GR item cụ thể (theo productId).
 * Tổng qty của các batch phải = qtyReceived - qtyReturned của GR item đó.
 */
export class GrItemBatchSplitDto {
  @IsString()
  productId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GrItemBatchDto)
  batches!: GrItemBatchDto[];
}

/**
 * Payload (optional) khi confirm GR.
 *  - Nếu KHÔNG truyền itemBatches → service tự tạo 1 batch single per GR item
 *    (batch_code auto-gen, exp_date = product.expiredAt nếu có).
 *  - Nếu CÓ truyền → service validate tổng qty rồi tạo theo split.
 */
export class ConfirmGrDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GrItemBatchSplitDto)
  itemBatches?: GrItemBatchSplitDto[];
}
