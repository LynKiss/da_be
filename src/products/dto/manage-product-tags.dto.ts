import { ArrayUnique, IsArray, IsString } from 'class-validator';

export class ManageProductTagsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  tagIds: string[];
}
