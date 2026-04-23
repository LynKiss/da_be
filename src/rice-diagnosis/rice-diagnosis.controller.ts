import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  Public,
  RequirePermissions,
  ResponseMessage,
  User,
} from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { CreateRiceDiseaseDto } from './dto/create-rice-disease.dto';
import { QueryAdminRiceDiseasesDto } from './dto/query-admin-rice-diseases.dto';
import { UpdateRiceDiseaseDto } from './dto/update-rice-disease.dto';
import { RiceDiagnosisService } from './rice-diagnosis.service';

type UploadedImageFile = {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
};

@Controller('rice-diagnosis')
export class RiceDiagnosisController {
  constructor(private readonly riceDiagnosisService: RiceDiagnosisService) {}

  @Public()
  @Get('diseases')
  @ResponseMessage('Get public rice diseases')
  listPublicDiseases() {
    return this.riceDiagnosisService.listPublicDiseases();
  }

  @Public()
  @Get('diseases/:slug')
  @ResponseMessage('Get public rice disease detail')
  getPublicDisease(@Param('slug') slug: string) {
    return this.riceDiagnosisService.getPublicDiseaseBySlug(slug);
  }

  @Public()
  @Post('predict')
  @UseInterceptors(FileInterceptor('file'))
  @ResponseMessage('Predict rice disease from image')
  predict(@UploadedFile() file: UploadedImageFile) {
    return this.riceDiagnosisService.predict(file);
  }

  @Post('predict/me')
  @UseInterceptors(FileInterceptor('file'))
  @ResponseMessage('Predict rice disease from image for current user')
  predictForCurrentUser(
    @User() currentUser: IUser,
    @UploadedFile() file: UploadedImageFile,
  ) {
    return this.riceDiagnosisService.predict(file, currentUser);
  }

  @Get('history/me')
  @ResponseMessage('Get my rice diagnosis history')
  getMyHistory(@User() currentUser: IUser) {
    return this.riceDiagnosisService.listMyHistory(currentUser);
  }

  @Get('admin/service-status')
  @RequirePermissions('manage_ai_diagnosis')
  @ResponseMessage('Get rice AI service status')
  getAdminServiceStatus() {
    return this.riceDiagnosisService.getAdminServiceStatus();
  }

  @Get('admin/products')
  @RequirePermissions('manage_ai_diagnosis')
  @ResponseMessage('Get products for rice disease mapping')
  getAdminProducts(
    @Query('search') search?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.riceDiagnosisService.listAdminProducts(search, limit);
  }

  @Get('admin/diseases')
  @RequirePermissions('manage_ai_diagnosis')
  @ResponseMessage('Get admin rice disease list')
  getAdminDiseases(@Query() query: QueryAdminRiceDiseasesDto) {
    return this.riceDiagnosisService.listAdminDiseases(query);
  }

  @Get('admin/diseases/:id')
  @RequirePermissions('manage_ai_diagnosis')
  @ResponseMessage('Get admin rice disease detail')
  getAdminDisease(@Param('id') id: string) {
    return this.riceDiagnosisService.getAdminDisease(id);
  }

  @Post('admin/diseases')
  @RequirePermissions('manage_ai_diagnosis')
  @ResponseMessage('Create rice disease')
  createDisease(@Body() createRiceDiseaseDto: CreateRiceDiseaseDto) {
    return this.riceDiagnosisService.createDisease(createRiceDiseaseDto);
  }

  @Patch('admin/diseases/:id')
  @RequirePermissions('manage_ai_diagnosis')
  @ResponseMessage('Update rice disease')
  updateDisease(
    @Param('id') id: string,
    @Body() updateRiceDiseaseDto: UpdateRiceDiseaseDto,
  ) {
    return this.riceDiagnosisService.updateDisease(id, updateRiceDiseaseDto);
  }

  @Patch('admin/diseases/:id/toggle-active')
  @RequirePermissions('manage_ai_diagnosis')
  @ResponseMessage('Toggle rice disease active')
  toggleDiseaseActive(@Param('id') id: string) {
    return this.riceDiagnosisService.toggleDiseaseActive(id);
  }
}
