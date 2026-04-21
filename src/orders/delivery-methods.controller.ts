import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public, ResponseMessage } from '../decorator/customize';
import { DeliveryMethodEntity } from './entities/delivery-method.entity';

@Controller('delivery-methods')
export class DeliveryMethodsController {
  constructor(
    @InjectRepository(DeliveryMethodEntity)
    private readonly deliveryMethodsRepository: Repository<DeliveryMethodEntity>,
  ) {}

  @Public()
  @Get()
  @ResponseMessage('Get delivery methods')
  async getDeliveryMethods() {
    const methods = await this.deliveryMethodsRepository.find({
      where: { isActive: true },
      order: { basePrice: 'ASC' },
    });
    return methods.map((m) => ({
      id: m.deliveryId,
      name: m.name,
      description: m.description,
      basePrice: m.basePrice,
      minOrderAmount: m.minOrderAmount,
      region: m.region,
      isDefault: m.isDefault,
    }));
  }
}
