import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class UpsertCreditLimitDto {
  @IsUUID('all')
  userId: string;

  @IsNumber()
  @Min(0)
  creditLimit: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RecordPaymentDto {
  @IsUUID('all')
  userId: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
