import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaymentMethod } from '../entities/order.entity';

export class CreateOrderDto {
  @IsString()
  @MaxLength(20)
  shippingAddressId: string;

  @IsString()
  @MaxLength(20)
  deliveryId: string;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
