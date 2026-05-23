import { Type } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class CreateReturnDto {
  @IsString()
  @MaxLength(36)
  orderId: string;

  @IsString()
  @MaxLength(20)
  orderItemId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  returnQuantity: number;

  @IsString()
  @MaxLength(255)
  reason: string;

  @IsString()
  @MaxLength(1000)
  description: string;
}
