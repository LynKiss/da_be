import { MembershipTier } from '../users/entities/user.entity';

export interface TierConfig {
  tier: MembershipTier;
  minSpent: number;
  discountPercent: number;
  label: string;
  couponValidDays: number;
}

export const TIER_CONFIGS: TierConfig[] = [
  {
    tier: MembershipTier.DIAMOND,
    minSpent: 20_000_000,
    discountPercent: 15,
    label: 'Kim Cương',
    couponValidDays: 90,
  },
  {
    tier: MembershipTier.GOLD,
    minSpent: 10_000_000,
    discountPercent: 10,
    label: 'Vàng',
    couponValidDays: 60,
  },
  {
    tier: MembershipTier.SILVER,
    minSpent: 3_000_000,
    discountPercent: 5,
    label: 'Bạc',
    couponValidDays: 30,
  },
  {
    tier: MembershipTier.NONE,
    minSpent: 0,
    discountPercent: 0,
    label: 'Thường',
    couponValidDays: 0,
  },
];

export function calcTier(totalSpent: number): TierConfig {
  for (const cfg of TIER_CONFIGS) {
    if (totalSpent >= cfg.minSpent) return cfg;
  }
  return TIER_CONFIGS[TIER_CONFIGS.length - 1];
}
