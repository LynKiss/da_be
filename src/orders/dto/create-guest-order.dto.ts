import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '../entities/order.entity';

export class GuestOrderItemDto {
  @IsString()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class GuestShippingDto {
  @IsString()
  @MaxLength(150)
  recipientName: string;

  @IsString()
  @MaxLength(20)
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @MaxLength(255)
  addressLine: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  ward?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;

  @IsString()
  @MaxLength(100)
  province: string;
}

export class CreateGuestOrderDto {
  @ValidateNested()
  @Type(() => GuestShippingDto)
  shipping: GuestShippingDto;

  @IsString()
  @MaxLength(20)
  deliveryId: string;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GuestOrderItemDto)
  items: GuestOrderItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  discountCode?: string;

  @IsOptional()
  @IsBoolean()
  allowBackorder?: boolean;
}
