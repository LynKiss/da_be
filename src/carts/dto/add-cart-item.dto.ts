import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class AddCartItemDto {
  @IsString()
  @MaxLength(36)
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}
