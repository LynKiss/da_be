import { IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCancelPaidRefundDto {
  @IsString()
  @MaxLength(36)
  orderId: string;

  @IsOptional()
  @IsNumberString()
  amount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
