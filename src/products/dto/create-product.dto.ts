import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  productName: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  productSlug?: string;

  @IsNumberString()
  categoryId: string;

  @IsOptional()
  @IsNumberString()
  subcategoryId?: string;

  @IsOptional()
  @IsNumberString()
  originId?: string;

  @IsNumberString()
  productPrice: string;

  @IsOptional()
  @IsNumberString()
  productPriceSale?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  quantityAvailable?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isShow?: boolean;

  @IsOptional()
  @IsString()
  expiredAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  quantityPerBox?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  boxBarcode?: string;
}
