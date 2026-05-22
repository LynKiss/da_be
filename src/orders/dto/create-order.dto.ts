import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '../entities/order.entity';

export class PickupContactDto {
  @IsString()
  @MaxLength(150)
  recipientName: string;

  @IsString()
  @MaxLength(20)
  phone: string;
}

export class CreateOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  shippingAddressId?: string;

  @IsString()
  @MaxLength(20)
  deliveryId: string;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  discountCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cartHash?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PickupContactDto)
  pickupContact?: PickupContactDto;

  /**
   * Cho phép đặt hàng khi hết kho — đơn sẽ ở trạng thái BACKORDERED,
   * không trừ stock. Khi nhập hàng về (GR confirmed), admin có thể fulfill.
   */
  @IsOptional()
  @IsBoolean()
  allowBackorder?: boolean;
}
