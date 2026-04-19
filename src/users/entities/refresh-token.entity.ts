import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

@Entity({ name: 'refresh_tokens' })
export class RefreshTokenEntity {
  @PrimaryGeneratedColumn({
    name: 'token_id',
    type: 'bigint',
    unsigned: true,
  })
  tokenId: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId: string;

  @Column({ name: 'refresh_token', type: 'varchar', length: 500 })
  refreshToken: string;

  @Column({ name: 'expired_at', type: 'datetime' })
  expiredAt: Date;

  @Column({ name: 'is_revoked', type: 'tinyint', width: 1, default: () => '0' })
  isRevoked: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @ManyToOne(() => UserEntity, (user) => user.refreshTokens, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'userId' })
  user: UserEntity;
}
