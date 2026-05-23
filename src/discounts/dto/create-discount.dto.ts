import {
  ArrayUnique,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsArray,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { DiscountApplyTarget, DiscountType } from '../entities/discount.entity';

export class CreateDiscountDto {
  @IsString()
  @MaxLength(50)
  discountCode: string;

  @IsString()
  @MaxLength(255)
  discountName: string;

  @IsEnum(DiscountType)
  discountType: DiscountType;

  @IsOptional()
  @IsEnum(DiscountApplyTarget)
  appliesTo?: DiscountApplyTarget;

  @IsDateString()
  startAt: string;

  @IsDateString()
  expireDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(36)
  userId?: string;

  @IsOptional()
  @IsString()
  discountDescription?: string;

  @IsNumberString()
  discountValue: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @IsOptional()
  @IsNumberString()
  minOrderValue?: string;

  @IsOptional()
  @IsNumberString()
  maxDiscountAmount?: string;

  @ValidateIf(
    (o: CreateDiscountDto) => o.appliesTo === DiscountApplyTarget.CATEGORY,
  )
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  categoryIds?: string[];

  @ValidateIf(
    (o: CreateDiscountDto) => o.appliesTo === DiscountApplyTarget.PRODUCT,
  )
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  productIds?: string[];
}
