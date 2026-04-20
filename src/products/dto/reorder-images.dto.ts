import { ArrayUnique, IsArray, IsString } from 'class-validator';

export class ReorderImagesDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  imageIds: string[];
}
