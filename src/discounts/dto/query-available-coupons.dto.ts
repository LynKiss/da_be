import {
  ArrayUnique,
  IsArray,
  IsNumberString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CouponCartLineDto } from './validate-coupon.dto';

export class QueryAvailableCouponsDto {
  @IsOptional()
  @IsNumberString()
  orderValue?: string;

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
