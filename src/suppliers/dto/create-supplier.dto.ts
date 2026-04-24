import { IsEmail, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateSupplierDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  taxCode?: string;

  @IsOptional()
  @IsString()
  contactPerson?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTerms?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
