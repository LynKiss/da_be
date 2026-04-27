import {
  ArrayUnique,
  IsArray,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';

export class QueryAvailableCouponsDto {
  @IsOptional()
  @IsNumberString()
  orderValue?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  productIds?: string[];
}
