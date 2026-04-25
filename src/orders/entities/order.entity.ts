import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OrderStatus {
  PENDING = 'pending',
  BACKORDERED = 'backordered',
  CONFIRMED = 'confirmed',
  PROCESSING = 'processing',
  SHIPPING = 'shipping',
  DELIVERED = 'delivered',
  PARTIAL_DELIVERED = 'partial_delivered',
  CANCELLED = 'cancelled',
  RETURNED = 'returned',
}

export enum PaymentMethod {
  COD = 'cod',
  BANK_TRANSFER = 'bank_transfer',
  MOMO = 'momo',
  VNPAY = 'vnpay',
  ZALOPAY = 'zalopay',
  PAYPAL = 'paypal',
}

export enum PaymentStatus {
  UNPAID = 'unpaid',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

@Entity({ name: 'orders' })
export class OrderEntity {
  @PrimaryColumn({ name: 'order_id', type: 'char', length: 36 })
  orderId: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId: string;

  @Column({
    name: 'shipping_address_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  shippingAddressId: string | null;

  @Column({
    name: 'delivery_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  deliveryId: string | null;

  @Column({
    name: 'discount_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  discountId: string | null;

  @Column({
    name: 'order_status',
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  orderStatus: OrderStatus;

  @Column({
    name: 'payment_method',
    type: 'enum',
    enum: PaymentMethod,
  })
  paymentMethod: PaymentMethod;

  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.UNPAID,
  })
  paymentStatus: PaymentStatus;

  @Column({
    name: 'subtotal_amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: '0.00',
  })
  subtotalAmount: string;

  @Column({
    name: 'discount_amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: '0.00',
  })
  discountAmount: string;

  @Column({
    name: 'delivery_cost',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: '0.00',
  })
  deliveryCost: string;

  @Column({
    name: 'total_payment',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: '0.00',
  })
  totalPayment: string;

  @Column({ name: 'total_quantity', type: 'int', default: 0 })
  totalQuantity: number;

  @Column({ name: 'note', type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @Column({ name: 'full_name', type: 'varchar', length: 150 })
  fullName: string;

  @Column({ name: 'phone', type: 'varchar', length: 20 })
  phone: string;

  @Column({ name: 'address', type: 'varchar', length: 500 })
  address: string;

  @Index('idx_orders_idempotency_key', { unique: true })
  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  idempotencyKey: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
