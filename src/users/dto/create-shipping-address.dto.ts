import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateShippingAddressDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  recipientName: string;

  @IsString()
  @MinLength(8)
  @MaxLength(20)
  phone: string;

  @IsString()
  @MinLength(5)
  @MaxLength(255)
  addressLine: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ward?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  province?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
