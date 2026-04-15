import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateContactDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  subject: string;

  @IsString()
  @MinLength(5)
  message: string;
}
