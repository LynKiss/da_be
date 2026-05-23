import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrderRefundStatus } from '../entities/order-refund.entity';

export class UpdateOrderRefundStatusDto {
  @IsEnum(OrderRefundStatus)
  status: OrderRefundStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  manualReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
