import { PartialType } from '@nestjs/mapped-types';
import { CreateRiceDiseaseDto } from './create-rice-disease.dto';

export class UpdateRiceDiseaseDto extends PartialType(CreateRiceDiseaseDto) {}
