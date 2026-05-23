import {
  ArrayUnique,
  IsArray,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CouponCartLineDto {
  @IsString()
  productId: string;

  @IsNumberString()
  quantity: string;

  @IsNumberString()
  unitPrice: string;
}

export class ValidateCouponDto {
  @IsString()
  @MaxLength(50)
  discountCode: string;

  @IsNumberString()
  orderValue: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  productIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CouponCartLineDto)
  items?: CouponCartLineDto[];
}
