import { validate } from 'class-validator';
import { GuestShippingDto } from './create-guest-order.dto';
import { PickupContactDto } from './create-order.dto';

describe('fulfillment DTO validation', () => {
  it('rejects pickup contacts without real recipient text', async () => {
    const contact = Object.assign(new PickupContactDto(), {
      recipientName: '   ',
      phone: '',
    });

    const errors = await validate(contact);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['recipientName', 'phone']),
    );
  });

  it('rejects guest delivery addresses with blank required fields', async () => {
    const shipping = Object.assign(new GuestShippingDto(), {
      recipientName: '',
      phone: '   ',
      addressLine: '',
      province: '   ',
    });

    const errors = await validate(shipping);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'recipientName',
        'phone',
        'addressLine',
        'province',
      ]),
    );
  });
});
