import { IsOptional, IsString } from 'class-validator';

export class QueryInventoryLedgerDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() transactionType?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() page?: number;
  @IsOptional() limit?: number;
}

export class QueryProfitabilityDto {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() groupBy?: 'product' | 'day' | 'month';
  @IsOptional() page?: number;
  @IsOptional() limit?: number;
}

export class QueryAgingDebtDto {
  @IsOptional() @IsString() asOf?: string;
  @IsOptional() @IsString() supplierId?: string;
}

export class RecordPoPaymentDto {
  @IsString() poId: string;
  @IsString() amount: string;
  @IsOptional() @IsString() notes?: string;
}
