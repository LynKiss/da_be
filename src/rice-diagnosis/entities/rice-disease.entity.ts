import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RiceDiseaseSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

@Entity({ name: 'rice_diseases' })
export class RiceDiseaseEntity {
  @PrimaryGeneratedColumn({
    name: 'disease_id',
    type: 'bigint',
    unsigned: true,
  })
  diseaseId!: string;

  @Index('idx_rice_diseases_key', { unique: true })
  @Column({ name: 'disease_key', type: 'varchar', length: 120 })
  diseaseKey!: string;

  @Index('idx_rice_diseases_slug', { unique: true })
  @Column({ name: 'disease_slug', type: 'varchar', length: 180 })
  diseaseSlug!: string;

  @Column({ name: 'disease_name', type: 'varchar', length: 180 })
  diseaseName!: string;

  @Column({ name: 'summary', type: 'text', nullable: true })
  summary!: string | null;

  @Column({ name: 'symptoms', type: 'longtext', nullable: true })
  symptoms!: string | null;

  @Column({ name: 'causes', type: 'longtext', nullable: true })
  causes!: string | null;

  @Column({ name: 'treatment_guidance', type: 'longtext', nullable: true })
  treatmentGuidance!: string | null;

  @Column({ name: 'prevention_guidance', type: 'longtext', nullable: true })
  preventionGuidance!: string | null;

  @Column({
    name: 'severity',
    type: 'enum',
    enum: RiceDiseaseSeverity,
    default: RiceDiseaseSeverity.MEDIUM,
  })
  severity!: RiceDiseaseSeverity;

  @Column({
    name: 'recommended_ingredients',
    type: 'simple-json',
    nullable: true,
  })
  recommendedIngredients!: string[] | null;

  @Column({
    name: 'search_keywords',
    type: 'simple-json',
    nullable: true,
  })
  searchKeywords!: string[] | null;

  @Column({
    name: 'confidence_threshold',
    type: 'decimal',
    precision: 5,
    scale: 4,
    default: 0.9,
  })
  confidenceThreshold!: string;

  @Column({
    name: 'cover_image_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  coverImageUrl!: string | null;

  @Index('idx_rice_diseases_is_active')
  @Column({
    name: 'is_active',
    type: 'tinyint',
    width: 1,
    default: 1,
  })
  isActive!: boolean;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt!: Date;
}
