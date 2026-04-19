import { IsString, MaxLength } from 'class-validator';

export class CreateReturnDto {
  @IsString()
  @MaxLength(36)
  orderId: string;

  @IsString()
  @MaxLength(20)
  orderItemId: string;

  @IsString()
  @MaxLength(255)
  reason: string;

  @IsString()
  @MaxLength(1000)
  description: string;
}
