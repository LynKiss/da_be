import { PartialType } from '@nestjs/mapped-types';
import { CreateOriginDto } from './create-origin.dto';

export class UpdateOriginDto extends PartialType(CreateOriginDto) {}
