import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class PaymentCallbackDto {
  @IsString()
  @MaxLength(36)
  orderId: string;

  @IsString()
  @MaxLength(120)
  transactionRef: string;

  @IsString()
  @MaxLength(20)
  amount: string;

  @IsBoolean()
  success: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  gatewayCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  gatewayMessage?: string;

  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, unknown>;
}
