import { DeliveryMethodAreaEntity } from './entities/delivery-method-area.entity';
import { DeliveryMethodEntity } from './entities/delivery-method.entity';

export type FulfillmentType = 'delivery' | 'pickup';

export type DeliveryMethodQuote = {
  id: string;
  name: string;
  type: FulfillmentType;
  description: string | null;
  basePrice: number;
  minOrderAmount: number;
  freeShippingThreshold: number | null;
  etaMinDays: number | null;
  etaMaxDays: number | null;
  region: string | null;
  isDefault: boolean;
  isActive: boolean;
  areas: Array<{ id: string; province: string; district: string | null }>;
  eligible: boolean;
  shippingFee: number;
  freeShippingApplied: boolean;
  minimumOrderMet: boolean;
  areaMatched: boolean;
  ineligibleReason: 'MIN_ORDER' | 'OUT_OF_AREA' | null;
};

export function fulfillmentTypeOf(method: DeliveryMethodEntity): FulfillmentType {
  return method.isPickup ? 'pickup' : 'delivery';
}

export function normalizeLocation(value?: string | null) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function quoteDeliveryMethod(
  method: DeliveryMethodEntity,
  areas: DeliveryMethodAreaEntity[],
  subtotal: number,
  location?: { province?: string | null; district?: string | null },
): DeliveryMethodQuote {
  const type = fulfillmentTypeOf(method);
  const minimumOrderMet = subtotal >= Number(method.minOrderAmount ?? 0);
  const areaMatched =
    type === 'pickup' ||
    areas.length === 0 ||
    areas.some((area) => {
      if (
        normalizeLocation(area.province) !==
        normalizeLocation(location?.province)
      ) {
        return false;
      }

      if (!area.district) {
        return true;
      }

      return (
        normalizeLocation(area.district) ===
        normalizeLocation(location?.district)
      );
    });
  const freeShippingThreshold = method.freeShippingThreshold
    ? Number(method.freeShippingThreshold)
    : null;
  const freeShippingApplied =
    type === 'delivery' &&
    freeShippingThreshold !== null &&
    freeShippingThreshold > 0 &&
    subtotal >= freeShippingThreshold;
  const eligible = minimumOrderMet && areaMatched;
  const ineligibleReason = !minimumOrderMet
    ? 'MIN_ORDER'
    : !areaMatched
      ? 'OUT_OF_AREA'
      : null;

  return {
    id: method.deliveryId,
    name: method.name,
    type,
    description: method.description,
    basePrice: type === 'pickup' ? 0 : Number(method.basePrice),
    minOrderAmount: Number(method.minOrderAmount),
    freeShippingThreshold,
    etaMinDays: method.etaMinDays,
    etaMaxDays: method.etaMaxDays,
    region: method.region,
    isDefault: method.isDefault,
    isActive: method.isActive,
    areas: areas.map((area) => ({
      id: area.deliveryAreaId,
      province: area.province,
      district: area.district,
    })),
    eligible,
    shippingFee:
      !eligible || type === 'pickup' || freeShippingApplied
        ? 0
        : Number(method.basePrice),
    freeShippingApplied,
    minimumOrderMet,
    areaMatched,
    ineligibleReason,
  };
}
