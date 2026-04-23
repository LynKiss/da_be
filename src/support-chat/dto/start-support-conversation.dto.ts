import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class StartSupportConversationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  customerLookup: string;
}
