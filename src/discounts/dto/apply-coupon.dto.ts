import { IsString, MaxLength } from 'class-validator';

export class ApplyCouponDto {
  @IsString()
  @MaxLength(50)
  discountCode: string;

  @IsString()
  @MaxLength(36)
  orderId: string;
}
