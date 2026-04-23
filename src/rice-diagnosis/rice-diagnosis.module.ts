import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsModule } from '../products/products.module';
import { ProductEntity } from '../products/entities/product.entity';
import { RiceDiagnosisController } from './rice-diagnosis.controller';
import { RiceDiagnosisService } from './rice-diagnosis.service';
import { RiceDiagnosisHistoryEntity } from './entities/rice-diagnosis-history.entity';
import { RiceDiseaseRecommendationEntity } from './entities/rice-disease-recommendation.entity';
import { RiceDiseaseEntity } from './entities/rice-disease.entity';

@Module({
  imports: [
    ConfigModule,
    ProductsModule,
    TypeOrmModule.forFeature([
      RiceDiseaseEntity,
      RiceDiseaseRecommendationEntity,
      RiceDiagnosisHistoryEntity,
      ProductEntity,
    ]),
  ],
  controllers: [RiceDiagnosisController],
  providers: [RiceDiagnosisService],
  exports: [RiceDiagnosisService],
})
export class RiceDiagnosisModule {}
