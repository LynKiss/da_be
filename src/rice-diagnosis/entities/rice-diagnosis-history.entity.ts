import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export enum RiceDiagnosisRecommendationLevel {
  LOW = 'low',
  REVIEW = 'review',
  HIGH = 'high',
}

@Entity({ name: 'rice_diagnosis_history' })
export class RiceDiagnosisHistoryEntity {
  @PrimaryColumn({ name: 'diagnosis_id', type: 'char', length: 36 })
  diagnosisId!: string;

  @Index('idx_rice_diagnosis_history_user')
  @Column({ name: 'user_id', type: 'char', length: 36, nullable: true })
  userId!: string | null;

  @Index('idx_rice_diagnosis_history_disease')
  @Column({ name: 'disease_id', type: 'bigint', unsigned: true, nullable: true })
  diseaseId!: string | null;

  @Column({
    name: 'original_file_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  originalFileName!: string | null;

  @Column({
    name: 'image_mime_type',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  imageMimeType!: string | null;

  @Column({ name: 'image_size_bytes', type: 'int', unsigned: true, nullable: true })
  imageSizeBytes!: number | null;

  @Column({
    name: 'image_sha256',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  imageSha256!: string | null;

  @Column({
    name: 'predicted_label',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  predictedLabel!: string | null;

  @Column({
    name: 'predicted_disease_key',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  predictedDiseaseKey!: string | null;

  @Column({
    name: 'confidence',
    type: 'decimal',
    precision: 6,
    scale: 5,
    default: 0,
  })
  confidence!: string;

  @Column({
    name: 'recommendation_level',
    type: 'enum',
    enum: RiceDiagnosisRecommendationLevel,
    default: RiceDiagnosisRecommendationLevel.LOW,
  })
  recommendationLevel!: RiceDiagnosisRecommendationLevel;

  @Column({
    name: 'model_version',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  modelVersion!: string | null;

  @Column({
    name: 'model_task',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  modelTask!: string | null;

  @Column({
    name: 'top_predictions',
    type: 'simple-json',
    nullable: true,
  })
  topPredictions!: Array<{
    label: string;
    normalizedKey: string;
    confidence: number;
  }> | null;

  @Column({
    name: 'raw_response',
    type: 'simple-json',
    nullable: true,
  })
  rawResponse!: Record<string, unknown> | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;
}
