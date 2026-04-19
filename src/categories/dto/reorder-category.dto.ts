import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ReorderCategoryDto {
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsInt()
  @Min(0)
  targetIndex: number;
}
