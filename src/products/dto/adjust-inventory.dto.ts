import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export enum InventoryAdjustmentMode {
  SET = 'set',
  INCREASE = 'increase',
  DECREASE = 'decrease',
}

export class AdjustInventoryDto {
  @IsString()
  @MaxLength(36)
  productId: string;

  @IsEnum(InventoryAdjustmentMode)
  mode: InventoryAdjustmentMode;

  @IsInt()
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
