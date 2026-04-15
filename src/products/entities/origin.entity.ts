import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'origins' })
export class OriginEntity {
  @PrimaryGeneratedColumn({
    name: 'origin_id',
    type: 'bigint',
    unsigned: true,
  })
  originId: string;

  @Column({ name: 'origin_name', type: 'varchar', length: 150 })
  originName: string;

  @Column({
    name: 'origin_image',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  originImage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
