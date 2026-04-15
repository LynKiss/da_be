import { IsEnum } from 'class-validator';
import { ContactStatus } from '../entities/contact.entity';

export class UpdateContactStatusDto {
  @IsEnum(ContactStatus)
  status: ContactStatus;
}
