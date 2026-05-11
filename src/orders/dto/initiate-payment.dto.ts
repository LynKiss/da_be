import { IsOptional, IsString, MaxLength } from 'class-validator';

export class InitiatePaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  returnUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}
