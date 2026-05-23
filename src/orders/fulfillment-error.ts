import { BadRequestException, NotFoundException } from '@nestjs/common';

export const FulfillmentErrorCode = {
  DELIVERY_METHOD_INACTIVE: 'DELIVERY_METHOD_INACTIVE',
  DELIVERY_OUT_OF_AREA: 'DELIVERY_OUT_OF_AREA',
  DELIVERY_MIN_ORDER_NOT_MET: 'DELIVERY_MIN_ORDER_NOT_MET',
  PICKUP_CONTACT_REQUIRED: 'PICKUP_CONTACT_REQUIRED',
  SHIPPING_ADDRESS_REQUIRED: 'SHIPPING_ADDRESS_REQUIRED',
} as const;

export type FulfillmentErrorCode =
  (typeof FulfillmentErrorCode)[keyof typeof FulfillmentErrorCode];

export function inactiveDeliveryMethod(message = 'Phương thức nhận hàng không khả dụng') {
  return new NotFoundException({
    message,
    error: FulfillmentErrorCode.DELIVERY_METHOD_INACTIVE,
  });
}

export function invalidFulfillmentInput(
  error: Exclude<FulfillmentErrorCode, 'DELIVERY_METHOD_INACTIVE'>,
  message: string,
) {
  return new BadRequestException({ message, error });
}
