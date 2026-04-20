import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateOriginDto {
  @IsString()
  @MaxLength(150)
  originName: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  originImage?: string;
}
