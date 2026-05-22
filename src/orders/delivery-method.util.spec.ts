import { quoteDeliveryMethod } from './delivery-method.util';
import { DeliveryMethodAreaEntity } from './entities/delivery-method-area.entity';
import { DeliveryMethodEntity } from './entities/delivery-method.entity';

function method(overrides: Partial<DeliveryMethodEntity> = {}) {
  return {
    deliveryId: 'delivery-standard',
    name: 'Giao hàng tiêu chuẩn',
    description: null,
    basePrice: '25000.00',
    minOrderAmount: '0.00',
    freeShippingThreshold: null,
    etaMinDays: 2,
    etaMaxDays: 4,
    region: null,
    isPickup: false,
    isDefault: true,
    isActive: true,
    ...overrides,
  } as DeliveryMethodEntity;
}

function area(overrides: Partial<DeliveryMethodAreaEntity>) {
  return {
    deliveryAreaId: 'area-1',
    deliveryId: 'delivery-standard',
    province: 'Hà Nội',
    district: null,
    ...overrides,
  } as DeliveryMethodAreaEntity;
}

describe('quoteDeliveryMethod', () => {
  it('quotes a nationwide delivery method and applies free shipping threshold', () => {
    const quote = quoteDeliveryMethod(
      method({ freeShippingThreshold: '500000.00' }),
      [],
      600000,
      { province: 'Hưng Yên' },
    );

    expect(quote.eligible).toBe(true);
    expect(quote.areaMatched).toBe(true);
    expect(quote.shippingFee).toBe(0);
    expect(quote.freeShippingApplied).toBe(true);
  });

  it('matches province rules regardless of Vietnamese accents', () => {
    const quote = quoteDeliveryMethod(
      method(),
      [area({ province: 'Đà Nẵng' })],
      200000,
      { province: 'Da Nang', district: 'Hải Châu' },
    );

    expect(quote.eligible).toBe(true);
    expect(quote.shippingFee).toBe(25000);
  });

  it('requires the configured district when a district rule exists', () => {
    const outsideDistrict = quoteDeliveryMethod(
      method(),
      [area({ province: 'TP. Hồ Chí Minh', district: 'Quận 7' })],
      200000,
      { province: 'TP. Hồ Chí Minh', district: 'Quận 1' },
    );

    expect(outsideDistrict.eligible).toBe(false);
    expect(outsideDistrict.ineligibleReason).toBe('OUT_OF_AREA');
  });

  it('returns min order ineligibility before shipping fee is exposed', () => {
    const quote = quoteDeliveryMethod(
      method({ minOrderAmount: '300000.00' }),
      [],
      299999,
      { province: 'Hà Nội' },
    );

    expect(quote.eligible).toBe(false);
    expect(quote.ineligibleReason).toBe('MIN_ORDER');
    expect(quote.shippingFee).toBe(0);
  });

  it('keeps pickup free and independent from delivery areas', () => {
    const quote = quoteDeliveryMethod(
      method({
        deliveryId: 'pickup-store',
        name: 'Nhận tại cửa hàng',
        isPickup: true,
        basePrice: '99999.00',
      }),
      [area({ province: 'Hà Nội', district: 'Ba Đình' })],
      100000,
    );

    expect(quote.type).toBe('pickup');
    expect(quote.eligible).toBe(true);
    expect(quote.shippingFee).toBe(0);
    expect(quote.areaMatched).toBe(true);
  });
});
