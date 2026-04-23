import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RiceDiseaseEntity } from './rice-disease.entity';

@Entity({ name: 'rice_disease_recommendations' })
@Index('idx_rice_disease_recommendations_unique', ['diseaseId', 'productId'], {
  unique: true,
})
export class RiceDiseaseRecommendationEntity {
  @PrimaryGeneratedColumn({
    name: 'rice_disease_recommendation_id',
    type: 'bigint',
    unsigned: true,
  })
  riceDiseaseRecommendationId!: string;

  @Column({ name: 'disease_id', type: 'bigint', unsigned: true })
  diseaseId!: string;

  @Column({ name: 'product_id', type: 'char', length: 36 })
  productId!: string;

  @Column({ name: 'note', type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  @Column({ name: 'rationale', type: 'varchar', length: 255, nullable: true })
  rationale!: string | null;

  @Column({
    name: 'is_primary',
    type: 'tinyint',
    width: 1,
    default: 0,
  })
  isPrimary!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @ManyToOne(() => RiceDiseaseEntity, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'disease_id', referencedColumnName: 'diseaseId' })
  disease?: RiceDiseaseEntity;
}
