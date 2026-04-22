import { IsEnum } from 'class-validator';
import { OrderTrackingMode } from '../entities/order-tracking.entity';

export class UpdateOrderTrackingModeDto {
  @IsEnum(OrderTrackingMode)
  mode: OrderTrackingMode;
}
