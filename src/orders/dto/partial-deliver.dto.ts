import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PartialDeliverItemDto {
  @IsString()
  orderItemId: string;

  @IsInt()
  @Min(0)
  deliveredQty: number;
}

export class PartialDeliverDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PartialDeliverItemDto)
  items: PartialDeliverItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
