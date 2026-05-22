import {
  BadRequestException,
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
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { In, Repository } from 'typeorm';
import { Public, RequirePermissions, ResponseMessage } from '../decorator/customize';
import { quoteDeliveryMethod } from './delivery-method.util';
import { DeliveryMethodAreaEntity } from './entities/delivery-method-area.entity';
import { DeliveryMethodEntity } from './entities/delivery-method.entity';
import { OrderEntity } from './entities/order.entity';

class DeliveryMethodAreaDto {
  @IsString()
  @MaxLength(120)
  province: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string | null;
}

class CreateDeliveryMethodDto {
  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  basePrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  freeShippingThreshold?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  etaMinDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  etaMaxDays?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  region?: string | null;

  @IsOptional()
  @IsBoolean()
  isPickup?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryMethodAreaDto)
  areas?: DeliveryMethodAreaDto[];

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class UpdateDeliveryMethodDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  basePrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  freeShippingThreshold?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  etaMinDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  etaMaxDays?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  region?: string | null;

  @IsOptional()
  @IsBoolean()
  isPickup?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryMethodAreaDto)
  areas?: DeliveryMethodAreaDto[];

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class QuoteDeliveryMethodsDto {
  @IsNumber()
  @Min(0)
  subtotal: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  province?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;
}

@Controller('delivery-methods')
export class DeliveryMethodsController {
  constructor(
    @InjectRepository(DeliveryMethodEntity)
    private readonly deliveryMethodsRepository: Repository<DeliveryMethodEntity>,
    @InjectRepository(DeliveryMethodAreaEntity)
    private readonly deliveryMethodAreasRepository: Repository<DeliveryMethodAreaEntity>,
    @InjectRepository(OrderEntity)
    private readonly ordersRepository: Repository<OrderEntity>,
  ) {}

  @Public()
  @Get()
  @ResponseMessage('Get delivery methods')
  async getDeliveryMethods() {
    const methods = await this.deliveryMethodsRepository.find({
      where: { isActive: true },
      order: { basePrice: 'ASC' },
    });
    const areasByDeliveryId = await this.getAreasByDeliveryIds(
      methods.map((method) => method.deliveryId),
    );
    return methods.map((method) =>
      this.toResponse(method, areasByDeliveryId.get(method.deliveryId) ?? []),
    );
  }

  @Public()
  @Post('quote')
  @ResponseMessage('Quote delivery methods')
  async quoteDeliveryMethods(@Body() dto: QuoteDeliveryMethodsDto) {
    const methods = await this.deliveryMethodsRepository.find({
      where: { isActive: true },
      order: { isDefault: 'DESC', basePrice: 'ASC', createdAt: 'ASC' },
    });
    const areasByDeliveryId = await this.getAreasByDeliveryIds(
      methods.map((method) => method.deliveryId),
    );
    return methods.map((method) =>
      quoteDeliveryMethod(
        method,
        areasByDeliveryId.get(method.deliveryId) ?? [],
        dto.subtotal,
        {
          province: dto.province,
          district: dto.district,
        },
      ),
    );
  }

  @Get('admin/all')
  @RequirePermissions('manage_settings')
  @ResponseMessage('Get all delivery methods')
  async getAllDeliveryMethods() {
    const methods = await this.deliveryMethodsRepository.find({
      order: { createdAt: 'ASC' },
    });
    const areasByDeliveryId = await this.getAreasByDeliveryIds(
      methods.map((method) => method.deliveryId),
    );
    return methods.map((method) =>
      this.toResponse(method, areasByDeliveryId.get(method.deliveryId) ?? []),
    );
  }

  @Post()
  @RequirePermissions('manage_settings')
  @ResponseMessage('Create delivery method')
  async createDeliveryMethod(@Body() dto: CreateDeliveryMethodDto) {
    this.validateMethodPayload(dto);
    if (dto.isDefault) {
      await this.deliveryMethodsRepository.update({}, { isDefault: false });
    }
    const isPickup = Boolean(dto.isPickup);
    const method = this.deliveryMethodsRepository.create({
      name: dto.name,
      description: dto.description ?? null,
      basePrice: String(isPickup ? 0 : (dto.basePrice ?? 0)),
      minOrderAmount: String(dto.minOrderAmount ?? 0),
      freeShippingThreshold:
        isPickup || !dto.freeShippingThreshold
          ? null
          : String(dto.freeShippingThreshold),
      etaMinDays: isPickup ? null : (dto.etaMinDays ?? null),
      etaMaxDays: isPickup ? null : (dto.etaMaxDays ?? null),
      region: dto.region ?? null,
      isPickup,
      isDefault: isPickup ? false : (dto.isDefault ?? false),
      isActive: dto.isActive ?? true,
    });
    const saved = await this.deliveryMethodsRepository.save(method);
    const areas = await this.replaceAreas(saved, isPickup ? [] : dto.areas ?? []);
    return this.toResponse(saved, areas);
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

    this.validateMethodPayload(dto, method);
    if (dto.isDefault === true) {
      await this.deliveryMethodsRepository.update({}, { isDefault: false });
    }

    if (dto.name !== undefined) method.name = dto.name;
    if (dto.description !== undefined) method.description = dto.description ?? null;
    if (dto.basePrice !== undefined) method.basePrice = String(dto.basePrice);
    if (dto.minOrderAmount !== undefined) method.minOrderAmount = String(dto.minOrderAmount);
    if (dto.freeShippingThreshold !== undefined) {
      method.freeShippingThreshold = dto.freeShippingThreshold
        ? String(dto.freeShippingThreshold)
        : null;
    }
    if (dto.etaMinDays !== undefined) method.etaMinDays = dto.etaMinDays ?? null;
    if (dto.etaMaxDays !== undefined) method.etaMaxDays = dto.etaMaxDays ?? null;
    if (dto.region !== undefined) method.region = dto.region ?? null;
    if (dto.isPickup !== undefined) method.isPickup = dto.isPickup;
    if (dto.isDefault !== undefined) method.isDefault = dto.isDefault;
    if (dto.isActive !== undefined) method.isActive = dto.isActive;
    if (method.isPickup) {
      method.basePrice = '0';
      method.freeShippingThreshold = null;
      method.etaMinDays = null;
      method.etaMaxDays = null;
      method.isDefault = false;
    }

    const saved = await this.deliveryMethodsRepository.save(method);
    const areas =
      dto.areas !== undefined || method.isPickup
        ? await this.replaceAreas(saved, method.isPickup ? [] : dto.areas ?? [])
        : await this.deliveryMethodAreasRepository.find({
            where: { deliveryId: saved.deliveryId },
            order: { province: 'ASC', district: 'ASC' },
          });
    return this.toResponse(saved, areas);
  }

  @Delete(':id')
  @RequirePermissions('manage_settings')
  @HttpCode(200)
  @ResponseMessage('Delete delivery method')
  async deleteDeliveryMethod(@Param('id') id: string) {
    const method = await this.deliveryMethodsRepository.findOneBy({ deliveryId: id });
    if (!method) throw new NotFoundException('Delivery method not found');
    const referencedOrders = await this.ordersRepository.count({
      where: { deliveryId: id },
    });
    if (referencedOrders > 0) {
      method.isActive = false;
      method.isDefault = false;
      await this.deliveryMethodsRepository.save(method);
      return { deleted: false, deactivated: true };
    }
    await this.deliveryMethodAreasRepository.delete({ deliveryId: id });
    await this.deliveryMethodsRepository.remove(method);
    return { deleted: true };
  }

  private validateMethodPayload(
    dto: CreateDeliveryMethodDto | UpdateDeliveryMethodDto,
    current?: DeliveryMethodEntity,
  ) {
    const isPickup = dto.isPickup ?? current?.isPickup ?? false;
    const isDefault = dto.isDefault ?? current?.isDefault ?? false;
    const isActive = dto.isActive ?? current?.isActive ?? true;
    const etaMinDays = dto.etaMinDays ?? current?.etaMinDays ?? null;
    const etaMaxDays = dto.etaMaxDays ?? current?.etaMaxDays ?? null;

    if (isPickup && isDefault) {
      throw new BadRequestException(
        'Nhận tại cửa hàng không được đặt làm phương thức giao hàng mặc định',
      );
    }
    if (isDefault && !isActive) {
      throw new BadRequestException(
        'Phương thức mặc định phải đang hoạt động',
      );
    }
    if (
      etaMinDays !== null &&
      etaMaxDays !== null &&
      etaMaxDays < etaMinDays
    ) {
      throw new BadRequestException('ETA tối đa phải lớn hơn hoặc bằng ETA tối thiểu');
    }
  }

  private async replaceAreas(
    method: DeliveryMethodEntity,
    areas: DeliveryMethodAreaDto[],
  ) {
    await this.deliveryMethodAreasRepository.delete({
      deliveryId: method.deliveryId,
    });
    if (!areas.length) {
      return [];
    }
    const entities = this.deliveryMethodAreasRepository.create(
      areas.map((area) => ({
        deliveryId: method.deliveryId,
        province: area.province.trim(),
        district: area.district?.trim() || null,
      })),
    );
    return this.deliveryMethodAreasRepository.save(entities);
  }

  private async getAreasByDeliveryIds(deliveryIds: string[]) {
    if (!deliveryIds.length) {
      return new Map<string, DeliveryMethodAreaEntity[]>();
    }
    const areas = await this.deliveryMethodAreasRepository.find({
      where: { deliveryId: In(deliveryIds) },
      order: { province: 'ASC', district: 'ASC' },
    });
    const grouped = new Map<string, DeliveryMethodAreaEntity[]>();
    for (const area of areas) {
      const list = grouped.get(area.deliveryId) ?? [];
      list.push(area);
      grouped.set(area.deliveryId, list);
    }
    return grouped;
  }

  private toResponse(m: DeliveryMethodEntity, areas: DeliveryMethodAreaEntity[]) {
    return {
      id: m.deliveryId,
      name: m.name,
      type: m.isPickup ? 'pickup' : 'delivery',
      description: m.description,
      basePrice: Number(m.basePrice),
      minOrderAmount: Number(m.minOrderAmount),
      freeShippingThreshold: m.freeShippingThreshold
        ? Number(m.freeShippingThreshold)
        : null,
      etaMinDays: m.etaMinDays,
      etaMaxDays: m.etaMaxDays,
      region: m.region,
      areas: areas.map((area) => ({
        id: area.deliveryAreaId,
        province: area.province,
        district: area.district,
      })),
      isDefault: m.isDefault,
      isActive: m.isActive,
      createdAt: m.createdAt,
    };
  }
}
