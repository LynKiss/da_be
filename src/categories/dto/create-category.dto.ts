import { ToBoolean } from '../../common/dto-transformers';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  categoryName: string;

  @IsOptional()
  @ValidateIf((o: { categoryDescription?: string | null }) => o.categoryDescription !== null)
  @IsString()
  categoryDescription?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  categorySlug?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}
