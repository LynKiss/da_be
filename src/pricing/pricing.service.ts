import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ProductEntity } from '../products/entities/product.entity';
import { ApplyPriceDto, CalcPriceSuggestionDto } from './dto/price-suggestion.dto';
import { PriceSuggestionEntity } from './entities/price-suggestion.entity';

/**
 * Công thức đề xuất giá bán:
 * Giá bán = Giá vốn × (1 + % hao hụt/100 + % chi phí bán hàng/100 + % lãi/100)
 *
 * Giá thùng = Giá lẻ × số gói × (1 - % chiết khấu thùng/100)
 */
function calcSuggestedPrices(params: {
  landedCost: number;
  wastePct: number;
  sellingCostPct: number;
  profitPct: number;
  bulkDiscountPct: number;
  unitPerBulk: number;
}): { retail: number; bulk: number } {
  const { landedCost, wastePct, sellingCostPct, profitPct, bulkDiscountPct, unitPerBulk } = params;

  const multiplier = 1 + (wastePct + sellingCostPct + profitPct) / 100;
  const rawRetail = landedCost * multiplier;

  // Làm tròn lên đến hàng nghìn gần nhất
  const retail = Math.ceil(rawRetail / 1000) * 1000;

  const rawBulk = retail * unitPerBulk * (1 - bulkDiscountPct / 100);
  const bulk = Math.floor(rawBulk / 1000) * 1000;

  return { retail, bulk };
}

@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(PriceSuggestionEntity)
    private readonly repo: Repository<PriceSuggestionEntity>,

    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
  ) {}

  async calculate(dto: CalcPriceSuggestionDto, userId?: string) {
    const wastePct = dto.wastePct ?? 0;
    const sellingCostPct = dto.sellingCostPct ?? 0;
    const bulkDiscountPct = dto.bulkDiscountPct ?? 0;
    const unitPerBulk = dto.unitPerBulk ?? 1;

    const { retail, bulk } = calcSuggestedPrices({
      landedCost: dto.landedCost,
      wastePct,
      sellingCostPct,
      profitPct: dto.profitPct,
      bulkDiscountPct,
      unitPerBulk,
    });

    // Lưu lịch sử đề xuất
    const suggestion = this.repo.create({
      suggestionId: uuidv4(),
      productId: dto.productId,
      grId: dto.grId ?? null,
      landedCost: String(dto.landedCost),
      wastePct: String(wastePct),
      sellingCostPct: String(sellingCostPct),
      profitPct: String(dto.profitPct),
      bulkDiscountPct: String(bulkDiscountPct),
      unitPerBulk,
      suggestedRetail: String(retail),
      suggestedBulk: String(bulk),
      notes: dto.notes ?? null,
      createdBy: userId ?? null,
    });

    await this.repo.save(suggestion);

    return {
      ...suggestion,
      breakdown: {
        landedCost: dto.landedCost,
        wastePct,
        sellingCostPct,
        profitPct: dto.profitPct,
        totalMarkupPct: wastePct + sellingCostPct + dto.profitPct,
        rawRetailBeforeRound: Math.round(dto.landedCost * (1 + (wastePct + sellingCostPct + dto.profitPct) / 100)),
        suggestedRetail: retail,
        unitPerBulk,
        bulkDiscountPct,
        suggestedBulk: bulk,
      },
    };
  }

  async applyPrice(suggestionId: string, dto: ApplyPriceDto, userId?: string) {
    const suggestion = await this.repo.findOne({ where: { suggestionId } });
    if (!suggestion) throw new NotFoundException('Không tìm thấy đề xuất giá');

    suggestion.appliedRetail = String(dto.retailPrice);
    suggestion.appliedBulk = dto.bulkPrice != null ? String(dto.bulkPrice) : null;
    suggestion.appliedBy = userId ?? null;
    suggestion.appliedAt = new Date();
    await this.repo.save(suggestion);

    // Cập nhật giá trên sản phẩm
    const product = await this.productRepo.findOne({ where: { productId: suggestion.productId } });
    if (product) {
      product.productPrice = String(dto.retailPrice);
      if (dto.bulkPrice != null) {
        product.bulkPrice = String(dto.bulkPrice);
      }
      await this.productRepo.save(product);
    }

    return suggestion;
  }

  async findByProduct(productId: string) {
    return this.repo.find({
      where: { productId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  async findAll(page = 1, limit = 20) {
    const [items, total] = await this.repo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  /** Preview không lưu DB */
  preview(dto: CalcPriceSuggestionDto) {
    const wastePct = dto.wastePct ?? 0;
    const sellingCostPct = dto.sellingCostPct ?? 0;
    const bulkDiscountPct = dto.bulkDiscountPct ?? 0;
    const unitPerBulk = dto.unitPerBulk ?? 1;

    const { retail, bulk } = calcSuggestedPrices({
      landedCost: dto.landedCost,
      wastePct,
      sellingCostPct,
      profitPct: dto.profitPct,
      bulkDiscountPct,
      unitPerBulk,
    });

    return {
      landedCost: dto.landedCost,
      totalMarkupPct: wastePct + sellingCostPct + dto.profitPct,
      rawRetail: Math.round(dto.landedCost * (1 + (wastePct + sellingCostPct + dto.profitPct) / 100)),
      suggestedRetail: retail,
      unitPerBulk,
      bulkDiscountPct,
      suggestedBulk: bulk,
    };
  }
}
