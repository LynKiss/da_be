import {
  IsBoolean,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateSubcategoryDto {
  @IsNumberString()
  categoryId: string;

  @IsString()
  @MaxLength(150)
  subcategoryName: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  subcategorySlug?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
