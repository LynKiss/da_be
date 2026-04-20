import {
  ArrayUnique,
  IsArray,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

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
}
