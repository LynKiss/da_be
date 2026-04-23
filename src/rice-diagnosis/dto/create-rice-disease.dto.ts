import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ToBoolean } from '../../common/dto-transformers';
import { RiceDiseaseSeverity } from '../entities/rice-disease.entity';
import { RecommendedProductInputDto } from './recommended-product-input.dto';

export class CreateRiceDiseaseDto {
  @IsString()
  @MaxLength(120)
  diseaseKey!: string;

  @IsString()
  @MaxLength(180)
  diseaseName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  diseaseSlug?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  symptoms?: string;

  @IsOptional()
  @IsString()
  causes?: string;

  @IsOptional()
  @IsString()
  treatmentGuidance?: string;

  @IsOptional()
  @IsString()
  preventionGuidance?: string;

  @IsOptional()
  @IsEnum(RiceDiseaseSeverity)
  severity?: RiceDiseaseSeverity;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  recommendedIngredients?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  searchKeywords?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.5)
  @Max(0.99)
  confidenceThreshold?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverImageUrl?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecommendedProductInputDto)
  recommendedProducts?: RecommendedProductInputDto[];
}
