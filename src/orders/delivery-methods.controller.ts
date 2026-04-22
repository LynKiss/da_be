import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public, RequirePermissions, ResponseMessage } from '../decorator/customize';
import { DeliveryMethodEntity } from './entities/delivery-method.entity';

class CreateDeliveryMethodDto {
  name: string;
  description?: string | null;
  basePrice?: number;
  minOrderAmount?: number;
  region?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
}

class UpdateDeliveryMethodDto {
  name?: string;
  description?: string | null;
  basePrice?: number;
  minOrderAmount?: number;
  region?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
}

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
    return methods.map((m) => this.toResponse(m));
  }

  @Get('admin/all')
  @RequirePermissions('manage_settings')
  @ResponseMessage('Get all delivery methods')
  async getAllDeliveryMethods() {
    const methods = await this.deliveryMethodsRepository.find({
      order: { createdAt: 'ASC' },
    });
    return methods.map((m) => this.toResponse(m));
  }

  @Post()
  @RequirePermissions('manage_settings')
  @ResponseMessage('Create delivery method')
  async createDeliveryMethod(@Body() dto: CreateDeliveryMethodDto) {
    if (dto.isDefault) {
      await this.deliveryMethodsRepository.update({}, { isDefault: false });
    }
    const method = this.deliveryMethodsRepository.create({
      name: dto.name,
      description: dto.description ?? null,
      basePrice: String(dto.basePrice ?? 0),
      minOrderAmount: String(dto.minOrderAmount ?? 0),
      region: dto.region ?? null,
      isDefault: dto.isDefault ?? false,
      isActive: dto.isActive ?? true,
    });
    const saved = await this.deliveryMethodsRepository.save(method);
    return this.toResponse(saved);
  }

  @Patch(':id')
  @RequirePermissions('manage_settings')
  @ResponseMessage('Update delivery method')
  async updateDeliveryMethod(
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryMethodDto,
  ) {
    const method = await this.deliveryMethodsRepository.findOneBy({ deliveryId: id });
    if (!method) throw new NotFoundException('Delivery method not found');

    if (dto.isDefault === true) {
      await this.deliveryMethodsRepository.update({}, { isDefault: false });
    }

    if (dto.name !== undefined) method.name = dto.name;
    if (dto.description !== undefined) method.description = dto.description ?? null;
    if (dto.basePrice !== undefined) method.basePrice = String(dto.basePrice);
    if (dto.minOrderAmount !== undefined) method.minOrderAmount = String(dto.minOrderAmount);
    if (dto.region !== undefined) method.region = dto.region ?? null;
    if (dto.isDefault !== undefined) method.isDefault = dto.isDefault;
    if (dto.isActive !== undefined) method.isActive = dto.isActive;

    const saved = await this.deliveryMethodsRepository.save(method);
    return this.toResponse(saved);
  }

  @Delete(':id')
  @RequirePermissions('manage_settings')
  @HttpCode(200)
  @ResponseMessage('Delete delivery method')
  async deleteDeliveryMethod(@Param('id') id: string) {
    const method = await this.deliveryMethodsRepository.findOneBy({ deliveryId: id });
    if (!method) throw new NotFoundException('Delivery method not found');
    await this.deliveryMethodsRepository.remove(method);
    return { deleted: true };
  }

  private toResponse(m: DeliveryMethodEntity) {
    return {
      id: m.deliveryId,
      name: m.name,
      description: m.description,
      basePrice: Number(m.basePrice),
      minOrderAmount: Number(m.minOrderAmount),
      region: m.region,
      isDefault: m.isDefault,
      isActive: m.isActive,
      createdAt: m.createdAt,
    };
  }
}
