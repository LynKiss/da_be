import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'price_suggestions' })
export class PriceSuggestionEntity {
  @PrimaryColumn({ name: 'suggestion_id', type: 'char', length: 36 })
  suggestionId!: string;

  @Column({ name: 'product_id', type: 'char', length: 36 })
  productId!: string;

  @Column({ name: 'gr_id', type: 'char', length: 36, nullable: true })
  grId!: string | null;

  @Column({ name: 'landed_cost', type: 'decimal', precision: 15, scale: 2 })
  landedCost!: string;

  @Column({ name: 'waste_pct', type: 'decimal', precision: 5, scale: 2, default: 0 })
  wastePct!: string;

  @Column({ name: 'selling_cost_pct', type: 'decimal', precision: 5, scale: 2, default: 0 })
  sellingCostPct!: string;

  @Column({ name: 'profit_pct', type: 'decimal', precision: 5, scale: 2, default: 30 })
  profitPct!: string;

  @Column({ name: 'bulk_discount_pct', type: 'decimal', precision: 5, scale: 2, default: 0 })
  bulkDiscountPct!: string;

  @Column({ name: 'unit_per_bulk', type: 'int', default: 1 })
  unitPerBulk!: number;

  @Column({ name: 'suggested_retail', type: 'decimal', precision: 15, scale: 2, nullable: true })
  suggestedRetail!: string | null;

  @Column({ name: 'suggested_bulk', type: 'decimal', precision: 15, scale: 2, nullable: true })
  suggestedBulk!: string | null;

  @Column({ name: 'applied_retail', type: 'decimal', precision: 15, scale: 2, nullable: true })
  appliedRetail!: string | null;

  @Column({ name: 'applied_bulk', type: 'decimal', precision: 15, scale: 2, nullable: true })
  appliedBulk!: string | null;

  @Column({ name: 'applied_by', type: 'char', length: 36, nullable: true })
  appliedBy!: string | null;

  @Column({ name: 'applied_at', type: 'datetime', nullable: true })
  appliedAt!: Date | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'created_by', type: 'char', length: 36, nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
