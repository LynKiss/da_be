import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity({ name: 'saved_vouchers' })
@Unique('uq_saved_vouchers_user_discount', ['userId', 'discountId'])
export class SavedVoucherEntity {
  @PrimaryGeneratedColumn({
    name: 'saved_voucher_id',
    type: 'bigint',
    unsigned: true,
  })
  savedVoucherId: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId: string;

  @Column({ name: 'discount_id', type: 'bigint', unsigned: true })
  discountId: string;

  @CreateDateColumn({ name: 'saved_at', type: 'datetime' })
  savedAt: Date;
}
