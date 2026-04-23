import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateSupportMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content: string;
}
