import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
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

  @IsOptional()
  @IsString()
  @MaxLength(50)
  discountCode?: string;

  /**
   * Cho phép đặt hàng khi hết kho — đơn sẽ ở trạng thái BACKORDERED,
   * không trừ stock. Khi nhập hàng về (GR confirmed), admin có thể fulfill.
   */
  @IsOptional()
  @IsBoolean()
  allowBackorder?: boolean;
}
