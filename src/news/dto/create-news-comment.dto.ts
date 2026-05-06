import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateNewsCommentDto {
  @IsString()
  @MaxLength(2000)
  content: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];

  @IsOptional()
  @IsString()
  parentId?: string;
}
