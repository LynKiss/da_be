import { IsInt, IsString, MaxLength, Min, Max } from 'class-validator';

export class CreateReviewDto {
  @IsString()
  @MaxLength(20)
  orderItemId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @MaxLength(1000)
  content: string;
}
