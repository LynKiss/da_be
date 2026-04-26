import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderItemEntity } from '../orders/entities/order-item.entity';
import { OrderEntity, OrderStatus } from '../orders/entities/order.entity';
import { ProductImageEntity } from '../products/entities/product-image.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { QueryDemandForecastDto } from './dto/query-demand-forecast.dto';
import { QueryProductRecommendationsDto } from './dto/query-product-recommendations.dto';
import { QueryReorderSuggestionsDto } from './dto/query-reorder-suggestions.dto';

type DailyDemandPoint = {
  date: string;
  quantity: number;
};

type RawProductDemand = {
  productId: string;
  date: string;
  quantity: string;
};

type RecommendationInteraction = {
  userId: string;
  productId: string;
  quantity: number;
  orderCount: number;
};

type MatrixFactorizationModel = {
  modelType: 'matrix_factorization_sgd';
  status: 'trained';
  trainedAt: string;
  factors: number;
  epochs: number;
  trainInteractions: number;
  users: string[];
  products: string[];
  userFactors: number[][];
  itemFactors: number[][];
  itemBias: number[];
  globalMean: number;
  evaluation: {
    precisionAtK: number;
    holdoutUsers: number;
  };
};

type MatrixFactorizationTrainingResult =
  | MatrixFactorizationModel
  | {
      modelType: 'matrix_factorization_sgd';
      status: 'insufficient_data';
      reason: string;
    };

type TimeSeriesTrainingRow = {
  features: number[];
  target: number;
};

type RidgeRegressionModel = {
  modelType: 'ridge_regression_time_series';
  status: 'trained';
  trainedAt: string;
  featureNames: string[];
  weights: number[];
  means: number[];
  scales: number[];
  evaluation: {
    trainRows: number;
    testRows: number;
    mae: number;
    rmse: number;
    mape: number | null;
  };
};

type RidgeRegressionTrainingResult =
  | RidgeRegressionModel
  | {
      modelType: 'ridge_regression_time_series';
      status: 'insufficient_data';
      reason: string;
    };

const DEMAND_ORDER_STATUSES = [
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPING,
  OrderStatus.DELIVERED,
  OrderStatus.PARTIAL_DELIVERED,
];

@Injectable()
export class IntelligenceService {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly ordersRepository: Repository<OrderEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly orderItemsRepository: Repository<OrderItemEntity>,
    @InjectRepository(ProductEntity)
    private readonly productsRepository: Repository<ProductEntity>,
  ) {}

  async getProductRecommendations(query: QueryProductRecommendationsDto) {
    const limit = query.limit ?? 8;
    const historyDays = query.historyDays ?? 180;
    const since = this.daysAgo(historyDays);
    const [products, interactions] = await Promise.all([
      this.productsRepository.find({ where: { isShow: true } }),
      this.getRecommendationInteractions(since),
    ]);
    const productMap = new Map(
      products.map((product) => [product.productId, product]),
    );

    if (query.productId) {
      const sourceProduct = productMap.get(query.productId);
      if (!sourceProduct) {
        throw new NotFoundException('Product not found');
      }

      const model = this.trainMatrixFactorization(interactions);
      if (
        model.status === 'trained' &&
        model.products.includes(query.productId)
      ) {
        const recommendations = this.recommendByMatrixFactorization(
          model,
          query.productId,
          products,
          limit,
        );

        if (recommendations.length > 0) {
          return {
            mode: 'matrix_factorization',
            model,
            sourceProduct: this.mapProduct(sourceProduct),
            historyDays,
            items: recommendations,
          };
        }
      }

      const baseOrderCount = await this.countOrdersContainingProduct(
        query.productId,
        since,
      );
      const recommendations = await this.getCoPurchaseRecommendations(
        query.productId,
        since,
        limit,
        baseOrderCount,
      );

      if (recommendations.length > 0) {
        return {
          mode: 'co_purchase',
          model: {
            modelType: 'association_rules',
            status: 'fallback',
            reason:
              model.status === 'insufficient_data'
                ? model.reason
                : 'Matrix factorization did not produce candidates for this product.',
          },
          sourceProduct: this.mapProduct(sourceProduct),
          historyDays,
          items: recommendations,
        };
      }
    }

    return {
      mode: 'popular_products',
      model: {
        modelType: 'popular_products',
        status: 'fallback',
        reason:
          'No source product was provided, so personalized/item-similarity recommendations cannot be trained for a target item.',
      },
      sourceProduct: null,
      historyDays,
      items: await this.getPopularProductRecommendations(
        since,
        limit,
        query.productId,
      ),
    };
  }

  async getDemandForecast(query: QueryDemandForecastDto) {
    const historyDays = query.historyDays ?? 90;
    const horizonDays = query.horizonDays ?? 30;
    const product = await this.productsRepository.findOneBy({
      productId: query.productId,
      isShow: true,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const history = await this.getDailyDemandSeries(
      product.productId,
      historyDays,
    );
    const stats = this.calculateDemandStats(history);
    const model = this.trainDemandRegressionModel(history);
    const forecast =
      model.status === 'trained'
        ? this.buildRegressionForecast(history, horizonDays, model)
        : this.buildForecast(history, horizonDays);
    const totalForecastDemand = forecast.reduce(
      (sum, point) => sum + point.forecastQuantity,
      0,
    );

    return {
      product: this.mapProduct(product),
      model:
        model.status === 'trained'
          ? model
          : {
              modelType: 'moving_average_fallback',
              status: 'fallback',
              reason: model.reason,
            },
      historyDays,
      horizonDays,
      observedDemand: history,
      stats,
      forecast,
      summary: {
        currentStock: product.quantityAvailable,
        reservedStock: product.quantityReserved,
        totalForecastDemand: Number(totalForecastDemand.toFixed(2)),
        projectedStockAfterHorizon: Number(
          (product.quantityAvailable - totalForecastDemand).toFixed(2),
        ),
        confidence: this.getForecastConfidence(history),
      },
    };
  }

  async getReorderSuggestions(query: QueryReorderSuggestionsDto) {
    const historyDays = query.historyDays ?? 90;
    const leadTimeDays = query.leadTimeDays ?? 7;
    const coverageDays = query.coverageDays ?? 30;
    const limit = query.limit ?? 50;
    const includeAll = query.includeAll ?? false;
    const since = this.daysAgo(historyDays);

    const [products, rawDemand] = await Promise.all([
      this.productsRepository.find({
        where: { isShow: true },
        order: { quantityAvailable: 'ASC', productName: 'ASC' },
      }),
      this.getAllProductDailyDemand(since),
    ]);

    const demandByProduct = this.groupDemandByProduct(rawDemand, historyDays);
    const suggestions = products
      .map((product) =>
        this.buildReorderSuggestion(
          product,
          demandByProduct.get(product.productId) ??
            this.emptyDemandSeries(historyDays),
          leadTimeDays,
          coverageDays,
        ),
      )
      .filter((item) => includeAll || item.shouldReorder)
      .sort((left, right) => {
        const urgencyOrder = { high: 0, medium: 1, low: 2, none: 3 };
        return (
          urgencyOrder[left.urgency] - urgencyOrder[right.urgency] ||
          left.daysUntilStockoutValue - right.daysUntilStockoutValue ||
          right.suggestedOrderQty - left.suggestedOrderQty
        );
      })
      .slice(0, limit);

    return {
      historyDays,
      leadTimeDays,
      coverageDays,
      items: suggestions,
      summary: {
        totalProductsAnalyzed: products.length,
        totalSuggestions: suggestions.length,
        highUrgency: suggestions.filter((item) => item.urgency === 'high')
          .length,
        mediumUrgency: suggestions.filter((item) => item.urgency === 'medium')
          .length,
      },
    };
  }

  private async countOrdersContainingProduct(productId: string, since: Date) {
    const result = await this.orderItemsRepository
      .createQueryBuilder('item')
      .innerJoin(OrderEntity, 'order', 'order.order_id = item.order_id')
      .select('COUNT(DISTINCT item.order_id)', 'count')
      .where('item.product_id = :productId', { productId })
      .andWhere('order.order_status IN (:...statuses)', {
        statuses: DEMAND_ORDER_STATUSES,
      })
      .andWhere('order.created_at >= :since', { since })
      .getRawOne<{ count: string }>();

    return Number(result?.count ?? 0);
  }

  private async getCoPurchaseRecommendations(
    productId: string,
    since: Date,
    limit: number,
    baseOrderCount: number,
  ) {
    const rows = await this.orderItemsRepository
      .createQueryBuilder('target')
      .innerJoin(
        OrderItemEntity,
        'candidate',
        'candidate.order_id = target.order_id AND candidate.product_id <> :productId',
        { productId },
      )
      .innerJoin(OrderEntity, 'order', 'order.order_id = target.order_id')
      .innerJoin(
        ProductEntity,
        'product',
        'product.product_id = candidate.product_id',
      )
      .leftJoin(
        ProductImageEntity,
        'image',
        'image.product_id = product.product_id AND image.is_primary = 1',
      )
      .select('candidate.product_id', 'productId')
      .addSelect('product.product_name', 'productName')
      .addSelect('product.product_price', 'basePrice')
      .addSelect('product.product_price_sale', 'salePrice')
      .addSelect('product.quantity_available', 'quantityAvailable')
      .addSelect('product.unit', 'unit')
      .addSelect('image.image_url', 'primaryImageUrl')
      .addSelect('COUNT(DISTINCT target.order_id)', 'coOrderCount')
      .addSelect('SUM(candidate.quantity)', 'totalQuantitySold')
      .where('target.product_id = :productId', { productId })
      .andWhere('order.order_status IN (:...statuses)', {
        statuses: DEMAND_ORDER_STATUSES,
      })
      .andWhere('order.created_at >= :since', { since })
      .andWhere('product.is_show = 1')
      .groupBy('candidate.product_id')
      .addGroupBy('product.product_name')
      .addGroupBy('product.product_price')
      .addGroupBy('product.product_price_sale')
      .addGroupBy('product.quantity_available')
      .addGroupBy('product.unit')
      .addGroupBy('image.image_url')
      .orderBy('coOrderCount', 'DESC')
      .addOrderBy('totalQuantitySold', 'DESC')
      .limit(limit)
      .getRawMany<{
        productId: string;
        productName: string;
        basePrice: string;
        salePrice: string | null;
        quantityAvailable: string;
        unit: string | null;
        primaryImageUrl: string | null;
        coOrderCount: string;
        totalQuantitySold: string;
      }>();

    return rows.map((row) => {
      const coOrderCount = Number(row.coOrderCount);
      return {
        productId: row.productId,
        productName: row.productName,
        effectivePrice: row.salePrice ?? row.basePrice,
        basePrice: row.basePrice,
        unit: row.unit,
        quantityAvailable: Number(row.quantityAvailable),
        primaryImageUrl: row.primaryImageUrl,
        score: coOrderCount,
        confidence:
          baseOrderCount > 0
            ? Number((coOrderCount / baseOrderCount).toFixed(4))
            : 0,
        reason: `Thuong duoc mua chung trong ${coOrderCount} don hang gan day.`,
      };
    });
  }

  private async getPopularProductRecommendations(
    since: Date,
    limit: number,
    excludeProductId?: string,
  ) {
    const queryBuilder = this.orderItemsRepository
      .createQueryBuilder('item')
      .innerJoin(OrderEntity, 'order', 'order.order_id = item.order_id')
      .innerJoin(
        ProductEntity,
        'product',
        'product.product_id = item.product_id',
      )
      .leftJoin(
        ProductImageEntity,
        'image',
        'image.product_id = product.product_id AND image.is_primary = 1',
      )
      .select('item.product_id', 'productId')
      .addSelect('product.product_name', 'productName')
      .addSelect('product.product_price', 'basePrice')
      .addSelect('product.product_price_sale', 'salePrice')
      .addSelect('product.quantity_available', 'quantityAvailable')
      .addSelect('product.unit', 'unit')
      .addSelect('image.image_url', 'primaryImageUrl')
      .addSelect('COUNT(DISTINCT item.order_id)', 'orderCount')
      .addSelect('SUM(item.quantity)', 'totalQuantitySold')
      .where('order.order_status IN (:...statuses)', {
        statuses: DEMAND_ORDER_STATUSES,
      })
      .andWhere('order.created_at >= :since', { since })
      .andWhere('product.is_show = 1');

    if (excludeProductId) {
      queryBuilder.andWhere('item.product_id <> :excludeProductId', {
        excludeProductId,
      });
    }

    const rows = await queryBuilder
      .groupBy('item.product_id')
      .addGroupBy('product.product_name')
      .addGroupBy('product.product_price')
      .addGroupBy('product.product_price_sale')
      .addGroupBy('product.quantity_available')
      .addGroupBy('product.unit')
      .addGroupBy('image.image_url')
      .orderBy('totalQuantitySold', 'DESC')
      .addOrderBy('orderCount', 'DESC')
      .limit(limit)
      .getRawMany<{
        productId: string;
        productName: string;
        basePrice: string;
        salePrice: string | null;
        quantityAvailable: string;
        unit: string | null;
        primaryImageUrl: string | null;
        orderCount: string;
        totalQuantitySold: string;
      }>();

    return rows.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      effectivePrice: row.salePrice ?? row.basePrice,
      basePrice: row.basePrice,
      unit: row.unit,
      quantityAvailable: Number(row.quantityAvailable),
      primaryImageUrl: row.primaryImageUrl,
      score: Number(row.totalQuantitySold),
      confidence: Number(row.orderCount),
      reason: `Ban chay trong ${row.orderCount} don hang gan day, tong ${row.totalQuantitySold} san pham.`,
    }));
  }

  private async getRecommendationInteractions(since: Date) {
    const rows = await this.orderItemsRepository
      .createQueryBuilder('item')
      .innerJoin(OrderEntity, 'order', 'order.order_id = item.order_id')
      .select('order.user_id', 'userId')
      .addSelect('item.product_id', 'productId')
      .addSelect('SUM(item.quantity)', 'quantity')
      .addSelect('COUNT(DISTINCT item.order_id)', 'orderCount')
      .where('order.order_status IN (:...statuses)', {
        statuses: DEMAND_ORDER_STATUSES,
      })
      .andWhere('order.created_at >= :since', { since })
      .andWhere('order.user_id NOT LIKE :guestPrefix', {
        guestPrefix: 'guest-%',
      })
      .groupBy('order.user_id')
      .addGroupBy('item.product_id')
      .getRawMany<{
        userId: string;
        productId: string;
        quantity: string;
        orderCount: string;
      }>();

    return rows.map((row) => ({
      userId: row.userId,
      productId: row.productId,
      quantity: Number(row.quantity),
      orderCount: Number(row.orderCount),
    }));
  }

  private trainMatrixFactorization(
    interactions: RecommendationInteraction[],
  ): MatrixFactorizationTrainingResult {
    const users = [...new Set(interactions.map((item) => item.userId))];
    const products = [...new Set(interactions.map((item) => item.productId))];

    if (users.length < 2 || products.length < 2 || interactions.length < 4) {
      return {
        modelType: 'matrix_factorization_sgd',
        status: 'insufficient_data',
        reason:
          'Can toi thieu 2 khach hang, 2 san pham va 4 interaction mua hang de train matrix factorization.',
      };
    }

    const userIndex = new Map(users.map((userId, index) => [userId, index]));
    const productIndex = new Map(
      products.map((productId, index) => [productId, index]),
    );
    const factors = Math.min(
      12,
      Math.max(4, Math.floor(Math.sqrt(products.length))),
    );
    const epochs = 80;
    const learningRate = 0.035;
    const regularization = 0.025;
    const seed = 1337;
    const random = this.seededRandom(seed);
    const userFactors = users.map(() =>
      Array.from({ length: factors }, () => (random() - 0.5) * 0.1),
    );
    const itemFactors = products.map(() =>
      Array.from({ length: factors }, () => (random() - 0.5) * 0.1),
    );
    const itemBias = Array.from({ length: products.length }, () => 0);
    const trainingRows = interactions.map((interaction) => ({
      userIndex: userIndex.get(interaction.userId) ?? 0,
      productIndex: productIndex.get(interaction.productId) ?? 0,
      rating: Math.log1p(interaction.quantity) + interaction.orderCount * 0.2,
    }));
    const globalMean = this.average(trainingRows.map((row) => row.rating));

    for (let epoch = 0; epoch < epochs; epoch += 1) {
      for (const row of this.shuffleDeterministic(trainingRows, epoch + seed)) {
        const userVector = userFactors[row.userIndex];
        const itemVector = itemFactors[row.productIndex];
        const predicted =
          globalMean +
          itemBias[row.productIndex] +
          this.dot(userVector, itemVector);
        const error = row.rating - predicted;

        itemBias[row.productIndex] +=
          learningRate * (error - regularization * itemBias[row.productIndex]);

        for (let factor = 0; factor < factors; factor += 1) {
          const userValue = userVector[factor];
          const itemValue = itemVector[factor];
          userVector[factor] +=
            learningRate * (error * itemValue - regularization * userValue);
          itemVector[factor] +=
            learningRate * (error * userValue - regularization * itemValue);
        }
      }
    }

    return {
      modelType: 'matrix_factorization_sgd',
      status: 'trained',
      trainedAt: new Date().toISOString(),
      factors,
      epochs,
      trainInteractions: interactions.length,
      users,
      products,
      userFactors,
      itemFactors,
      itemBias,
      globalMean,
      evaluation: this.evaluateMatrixFactorization(
        interactions,
        users,
        products,
        itemFactors,
      ),
    };
  }

  private recommendByMatrixFactorization(
    model: MatrixFactorizationModel,
    sourceProductId: string,
    products: ProductEntity[],
    limit: number,
  ) {
    const sourceIndex = model.products.indexOf(sourceProductId);
    if (sourceIndex < 0) {
      return [];
    }

    const productMap = new Map(
      products.map((product) => [product.productId, product]),
    );
    const sourceVector = model.itemFactors[sourceIndex];

    return model.products
      .map((productId, index) => ({
        productId,
        similarity: this.cosineSimilarity(
          sourceVector,
          model.itemFactors[index],
        ),
      }))
      .filter((item) => item.productId !== sourceProductId)
      .map((item) => ({
        ...item,
        product: productMap.get(item.productId),
      }))
      .filter(
        (
          item,
        ): item is {
          productId: string;
          similarity: number;
          product: ProductEntity;
        } => Boolean(item.product?.isShow),
      )
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, limit)
      .map((item) => ({
        ...this.mapProduct(item.product),
        primaryImageUrl: null,
        score: Number(item.similarity.toFixed(4)),
        confidence: Number(Math.max(0, item.similarity).toFixed(4)),
        reason:
          'Duoc goi y boi mo hinh matrix factorization dua tren hanh vi mua hang cua khach hang.',
      }));
  }

  private evaluateMatrixFactorization(
    interactions: RecommendationInteraction[],
    users: string[],
    products: string[],
    itemFactors: number[][],
  ) {
    const byUser = new Map<string, string[]>();
    for (const interaction of interactions) {
      byUser.set(interaction.userId, [
        ...(byUser.get(interaction.userId) ?? []),
        interaction.productId,
      ]);
    }

    let hits = 0;
    let evaluated = 0;
    for (const userId of users) {
      const purchased = [...new Set(byUser.get(userId) ?? [])];
      if (purchased.length < 2) continue;

      const holdout = purchased[purchased.length - 1];
      const source = purchased[0];
      const sourceIndex = products.indexOf(source);
      const holdoutIndex = products.indexOf(holdout);
      if (sourceIndex < 0 || holdoutIndex < 0) continue;

      const sourceVector = itemFactors[sourceIndex];
      const top = products
        .map((productId, index) => ({
          productId,
          similarity: this.cosineSimilarity(sourceVector, itemFactors[index]),
        }))
        .filter((item) => item.productId !== source)
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, 5);

      if (top.some((item) => item.productId === holdout)) {
        hits += 1;
      }
      evaluated += 1;
    }

    return {
      precisionAtK: evaluated > 0 ? Number((hits / evaluated).toFixed(4)) : 0,
      holdoutUsers: evaluated,
    };
  }

  private async getDailyDemandSeries(productId: string, historyDays: number) {
    const end = this.startOfDay(new Date());
    const start = this.daysAgo(historyDays - 1, end);
    const raw = await this.orderItemsRepository
      .createQueryBuilder('item')
      .innerJoin(OrderEntity, 'order', 'order.order_id = item.order_id')
      .select('DATE(order.created_at)', 'date')
      .addSelect('SUM(item.quantity)', 'quantity')
      .where('item.product_id = :productId', { productId })
      .andWhere('order.order_status IN (:...statuses)', {
        statuses: DEMAND_ORDER_STATUSES,
      })
      .andWhere('order.created_at BETWEEN :start AND :end', {
        start,
        end: this.endOfDay(end),
      })
      .groupBy('DATE(order.created_at)')
      .orderBy('date', 'ASC')
      .getRawMany<{ date: string; quantity: string }>();

    const quantityByDate = new Map(
      raw.map((row) => [this.toDateKey(row.date), Number(row.quantity)]),
    );

    return this.dateRange(start, end).map((date) => ({
      date: this.toDateKey(date),
      quantity: quantityByDate.get(this.toDateKey(date)) ?? 0,
    }));
  }

  private async getAllProductDailyDemand(since: Date) {
    return this.orderItemsRepository
      .createQueryBuilder('item')
      .innerJoin(OrderEntity, 'order', 'order.order_id = item.order_id')
      .select('item.product_id', 'productId')
      .addSelect('DATE(order.created_at)', 'date')
      .addSelect('SUM(item.quantity)', 'quantity')
      .where('order.order_status IN (:...statuses)', {
        statuses: DEMAND_ORDER_STATUSES,
      })
      .andWhere('order.created_at >= :since', { since })
      .groupBy('item.product_id')
      .addGroupBy('DATE(order.created_at)')
      .getRawMany<RawProductDemand>();
  }

  private groupDemandByProduct(rows: RawProductDemand[], historyDays: number) {
    const end = this.startOfDay(new Date());
    const start = this.daysAgo(historyDays - 1, end);
    const baseDates = this.dateRange(start, end).map((date) =>
      this.toDateKey(date),
    );
    const grouped = new Map<string, Map<string, number>>();

    for (const row of rows) {
      const dateKey = this.toDateKey(row.date);
      const current = grouped.get(row.productId) ?? new Map<string, number>();
      current.set(dateKey, Number(row.quantity));
      grouped.set(row.productId, current);
    }

    const result = new Map<string, DailyDemandPoint[]>();
    for (const [productId, quantityByDate] of grouped.entries()) {
      result.set(
        productId,
        baseDates.map((date) => ({
          date,
          quantity: quantityByDate.get(date) ?? 0,
        })),
      );
    }

    return result;
  }

  private buildReorderSuggestion(
    product: ProductEntity,
    demand: DailyDemandPoint[],
    leadTimeDays: number,
    coverageDays: number,
  ) {
    const stats = this.calculateDemandStats(demand);
    const forecastModel = this.trainDemandRegressionModel(demand);
    const planningForecast =
      forecastModel.status === 'trained'
        ? this.buildRegressionForecast(
            demand,
            leadTimeDays + coverageDays,
            forecastModel,
          )
        : this.buildForecast(demand, leadTimeDays + coverageDays);
    const leadTimeDemand = planningForecast
      .slice(0, leadTimeDays)
      .reduce((sum, point) => sum + point.forecastQuantity, 0);
    const coverageDemand = planningForecast.reduce(
      (sum, point) => sum + point.forecastQuantity,
      0,
    );
    const avgDailyDemand =
      planningForecast.length > 0
        ? coverageDemand / planningForecast.length
        : stats.weightedAverageDailyDemand;
    const safetyStock = Math.ceil(
      stats.stdDev30 * Math.sqrt(leadTimeDays) * 1.65,
    );
    const reorderPoint = Math.ceil(leadTimeDemand + safetyStock);
    const targetStock = Math.ceil(coverageDemand + safetyStock);
    const suggestedOrderQty = Math.max(
      0,
      targetStock - product.quantityAvailable,
    );
    const daysUntilStockout =
      avgDailyDemand > 0
        ? Number((product.quantityAvailable / avgDailyDemand).toFixed(1))
        : null;
    const shouldReorder =
      avgDailyDemand > 0 && product.quantityAvailable <= reorderPoint;
    const urgency = this.getReorderUrgency(
      shouldReorder,
      product.quantityAvailable,
      reorderPoint,
      daysUntilStockout,
      leadTimeDays,
    );

    return {
      product: this.mapProduct(product),
      avgDailyDemand: Number(avgDailyDemand.toFixed(2)),
      demandStdDev30: Number(stats.stdDev30.toFixed(2)),
      safetyStock,
      reorderPoint,
      targetStock,
      suggestedOrderQty,
      daysUntilStockout,
      daysUntilStockoutValue: daysUntilStockout ?? Number.POSITIVE_INFINITY,
      shouldReorder,
      urgency,
      model:
        forecastModel.status === 'trained'
          ? {
              modelType: forecastModel.modelType,
              mae: forecastModel.evaluation.mae,
              rmse: forecastModel.evaluation.rmse,
            }
          : {
              modelType: 'moving_average_fallback',
              reason: forecastModel.reason,
            },
      reason: this.buildReorderReason(
        product.quantityAvailable,
        reorderPoint,
        daysUntilStockout,
        leadTimeDays,
      ),
    };
  }

  private trainDemandRegressionModel(
    history: DailyDemandPoint[],
  ): RidgeRegressionTrainingResult {
    const rows = this.buildTimeSeriesTrainingRows(history);
    if (
      rows.length < 21 ||
      history.filter((point) => point.quantity > 0).length < 4
    ) {
      return {
        modelType: 'ridge_regression_time_series',
        status: 'insufficient_data',
        reason:
          'Can toi thieu 21 training rows va 4 ngay co ban hang de train time-series regression.',
      };
    }

    const testSize = Math.max(5, Math.floor(rows.length * 0.2));
    const trainRows = rows.slice(0, -testSize);
    const testRows = rows.slice(-testSize);
    const featureNames = [
      'bias',
      'trend',
      'weekday_sin',
      'weekday_cos',
      'lag_1',
      'lag_7',
      'moving_avg_7',
      'moving_avg_14',
      'non_zero_rate_14',
    ];
    const normalized = this.normalizeTrainingRows(trainRows, testRows);
    const weights = this.fitRidgeRegression(
      normalized.train.map((row) => row.features),
      normalized.train.map((row) => row.target),
      0.08,
      0.01,
      900,
    );
    const predictions = normalized.test.map((row) =>
      Math.max(0, this.dot(weights, row.features)),
    );
    const actual = normalized.test.map((row) => row.target);

    return {
      modelType: 'ridge_regression_time_series',
      status: 'trained',
      trainedAt: new Date().toISOString(),
      featureNames,
      weights,
      means: normalized.means,
      scales: normalized.scales,
      evaluation: {
        trainRows: trainRows.length,
        testRows: testRows.length,
        mae: Number(this.mae(actual, predictions).toFixed(3)),
        rmse: Number(this.rmse(actual, predictions).toFixed(3)),
        mape: this.mape(actual, predictions),
      },
    };
  }

  private buildRegressionForecast(
    history: DailyDemandPoint[],
    horizonDays: number,
    model: RidgeRegressionModel,
  ) {
    const rollingHistory = [...history];
    const lastDate = new Date(history[history.length - 1]?.date ?? new Date());

    return Array.from({ length: horizonDays }, (_, index) => {
      const date = this.addDays(lastDate, index + 1);
      const rawFeatures = this.buildTimeSeriesFeatures(rollingHistory, date);
      const features = rawFeatures.map((value, featureIndex) =>
        featureIndex === 0
          ? 1
          : (value - model.means[featureIndex]) / model.scales[featureIndex],
      );
      const forecastQuantity = Math.max(0, this.dot(model.weights, features));
      const point = {
        date: this.toDateKey(date),
        forecastQuantity: Number(forecastQuantity.toFixed(2)),
        model: model.modelType,
      };
      rollingHistory.push({
        date: point.date,
        quantity: forecastQuantity,
      });
      return point;
    });
  }

  private buildTimeSeriesTrainingRows(history: DailyDemandPoint[]) {
    const rows: TimeSeriesTrainingRow[] = [];
    for (let index = 14; index < history.length; index += 1) {
      rows.push({
        features: this.buildTimeSeriesFeatures(
          history.slice(0, index),
          new Date(history[index].date),
        ),
        target: history[index].quantity,
      });
    }
    return rows;
  }

  private buildTimeSeriesFeatures(history: DailyDemandPoint[], date: Date) {
    const quantities = history.map((point) => point.quantity);
    const weekday = date.getDay();
    const trend = history.length;
    const lag1 = quantities[quantities.length - 1] ?? 0;
    const lag7 = quantities[quantities.length - 7] ?? lag1;
    const last7 = quantities.slice(-7);
    const last14 = quantities.slice(-14);

    return [
      1,
      trend,
      Math.sin((2 * Math.PI * weekday) / 7),
      Math.cos((2 * Math.PI * weekday) / 7),
      lag1,
      lag7,
      this.average(last7),
      this.average(last14),
      last14.length > 0
        ? last14.filter((quantity) => quantity > 0).length / last14.length
        : 0,
    ];
  }

  private normalizeTrainingRows(
    trainRows: TimeSeriesTrainingRow[],
    testRows: TimeSeriesTrainingRow[],
  ) {
    const featureCount = trainRows[0]?.features.length ?? 0;
    const means = Array.from({ length: featureCount }, (_, featureIndex) =>
      featureIndex === 0
        ? 0
        : this.average(trainRows.map((row) => row.features[featureIndex])),
    );
    const scales = Array.from({ length: featureCount }, (_, featureIndex) => {
      if (featureIndex === 0) return 1;
      const mean = means[featureIndex];
      const variance = this.average(
        trainRows.map((row) => Math.pow(row.features[featureIndex] - mean, 2)),
      );
      const scale = Math.sqrt(variance);
      return scale > 0 ? scale : 1;
    });
    const normalize = (row: TimeSeriesTrainingRow) => ({
      target: row.target,
      features: row.features.map((value, featureIndex) =>
        featureIndex === 0
          ? 1
          : (value - means[featureIndex]) / scales[featureIndex],
      ),
    });

    return {
      means,
      scales,
      train: trainRows.map(normalize),
      test: testRows.map(normalize),
    };
  }

  private fitRidgeRegression(
    features: number[][],
    targets: number[],
    learningRate: number,
    regularization: number,
    epochs: number,
  ) {
    const weights = Array.from({ length: features[0]?.length ?? 0 }, () => 0);
    if (features.length === 0) return weights;

    for (let epoch = 0; epoch < epochs; epoch += 1) {
      const gradients = Array.from({ length: weights.length }, () => 0);
      for (let rowIndex = 0; rowIndex < features.length; rowIndex += 1) {
        const prediction = this.dot(weights, features[rowIndex]);
        const error = prediction - targets[rowIndex];
        for (
          let featureIndex = 0;
          featureIndex < weights.length;
          featureIndex += 1
        ) {
          gradients[featureIndex] += error * features[rowIndex][featureIndex];
        }
      }

      for (
        let featureIndex = 0;
        featureIndex < weights.length;
        featureIndex += 1
      ) {
        const penalty =
          featureIndex === 0 ? 0 : regularization * weights[featureIndex];
        weights[featureIndex] -=
          learningRate * (gradients[featureIndex] / features.length + penalty);
      }
    }

    return weights;
  }

  private buildForecast(history: DailyDemandPoint[], horizonDays: number) {
    const stats = this.calculateDemandStats(history);
    const weeklyFactors = this.calculateWeeklySeasonality(history);
    const lastDate = new Date(history[history.length - 1]?.date ?? new Date());

    return Array.from({ length: horizonDays }, (_, index) => {
      const date = this.addDays(lastDate, index + 1);
      const factor = weeklyFactors[date.getDay()] ?? 1;
      const forecastQuantity = Math.max(
        0,
        stats.weightedAverageDailyDemand * factor,
      );

      return {
        date: this.toDateKey(date),
        forecastQuantity: Number(forecastQuantity.toFixed(2)),
        weekdayFactor: Number(factor.toFixed(3)),
      };
    });
  }

  private calculateDemandStats(history: DailyDemandPoint[]) {
    const quantities = history.map((point) => point.quantity);
    const last7 = quantities.slice(-7);
    const last30 = quantities.slice(-30);
    const avg7 = this.average(last7);
    const avg30 = this.average(last30);
    const avgAll = this.average(quantities);
    const weightedAverageDailyDemand =
      last30.length >= 30 ? avg7 * 0.6 + avg30 * 0.4 : avgAll;

    return {
      avg7: Number(avg7.toFixed(2)),
      avg30: Number(avg30.toFixed(2)),
      avgAll: Number(avgAll.toFixed(2)),
      weightedAverageDailyDemand,
      stdDev30: this.stdDev(last30),
      totalDemand: quantities.reduce((sum, value) => sum + value, 0),
      activeSalesDays: quantities.filter((value) => value > 0).length,
    };
  }

  private calculateWeeklySeasonality(history: DailyDemandPoint[]) {
    const avgAll = this.average(history.map((point) => point.quantity));
    if (avgAll <= 0) {
      return Array.from({ length: 7 }, () => 1);
    }

    return Array.from({ length: 7 }, (_, weekday) => {
      const values = history
        .filter((point) => new Date(point.date).getDay() === weekday)
        .map((point) => point.quantity);
      const factor = this.average(values) / avgAll;
      return Number.isFinite(factor) && factor > 0 ? factor : 1;
    });
  }

  private getForecastConfidence(history: DailyDemandPoint[]) {
    const activeDays = history.filter((point) => point.quantity > 0).length;
    if (history.length >= 90 && activeDays >= 15) return 'high';
    if (history.length >= 30 && activeDays >= 5) return 'medium';
    return 'low';
  }

  private getReorderUrgency(
    shouldReorder: boolean,
    currentStock: number,
    reorderPoint: number,
    daysUntilStockout: number | null,
    leadTimeDays: number,
  ): 'high' | 'medium' | 'low' | 'none' {
    if (!shouldReorder) return 'none';
    if (currentStock <= 0 || (daysUntilStockout ?? Infinity) <= leadTimeDays) {
      return 'high';
    }
    if (currentStock <= reorderPoint) return 'medium';
    return 'low';
  }

  private buildReorderReason(
    currentStock: number,
    reorderPoint: number,
    daysUntilStockout: number | null,
    leadTimeDays: number,
  ) {
    if (daysUntilStockout === null) {
      return 'Chua co du lieu ban hang du de tinh toc do tieu thu.';
    }

    if (currentStock <= reorderPoint) {
      return `Ton hien tai ${currentStock} <= diem dat hang lai ${reorderPoint}; du kien con ${daysUntilStockout} ngay hang, lead time ${leadTimeDays} ngay.`;
    }

    return `Ton hien tai van tren diem dat hang lai ${reorderPoint}; du kien con ${daysUntilStockout} ngay hang.`;
  }

  private mapProduct(product: ProductEntity) {
    return {
      productId: product.productId,
      productName: product.productName,
      effectivePrice: product.productPriceSale ?? product.productPrice,
      basePrice: product.productPrice,
      unit: product.unit,
      quantityAvailable: product.quantityAvailable,
      quantityReserved: product.quantityReserved,
      avgCost: product.avgCost,
    };
  }

  private emptyDemandSeries(historyDays: number) {
    const end = this.startOfDay(new Date());
    const start = this.daysAgo(historyDays - 1, end);
    return this.dateRange(start, end).map((date) => ({
      date: this.toDateKey(date),
      quantity: 0,
    }));
  }

  private dot(left: number[], right: number[]) {
    return left.reduce(
      (sum, value, index) => sum + value * (right[index] ?? 0),
      0,
    );
  }

  private cosineSimilarity(left: number[], right: number[]) {
    const denominator =
      Math.sqrt(this.dot(left, left)) * Math.sqrt(this.dot(right, right));
    if (denominator === 0) return 0;
    return this.dot(left, right) / denominator;
  }

  private seededRandom(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }

  private shuffleDeterministic<T>(items: T[], seed: number) {
    const random = this.seededRandom(seed);
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }

  private mae(actual: number[], predicted: number[]) {
    if (actual.length === 0) return 0;
    return this.average(
      actual.map((value, index) => Math.abs(value - (predicted[index] ?? 0))),
    );
  }

  private rmse(actual: number[], predicted: number[]) {
    if (actual.length === 0) return 0;
    return Math.sqrt(
      this.average(
        actual.map((value, index) =>
          Math.pow(value - (predicted[index] ?? 0), 2),
        ),
      ),
    );
  }

  private mape(actual: number[], predicted: number[]) {
    const rows = actual
      .map((value, index) => ({
        actual: value,
        predicted: predicted[index] ?? 0,
      }))
      .filter((row) => row.actual > 0);
    if (rows.length === 0) return null;
    const value =
      this.average(
        rows.map((row) => Math.abs(row.actual - row.predicted) / row.actual),
      ) * 100;
    return Number(value.toFixed(2));
  }

  private average(values: number[]) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private stdDev(values: number[]) {
    if (values.length <= 1) return 0;
    const avg = this.average(values);
    const variance =
      values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) /
      values.length;
    return Math.sqrt(variance);
  }

  private dateRange(start: Date, end: Date) {
    const dates: Date[] = [];
    let cursor = this.startOfDay(start);
    const last = this.startOfDay(end);
    while (cursor <= last) {
      dates.push(new Date(cursor));
      cursor = this.addDays(cursor, 1);
    }
    return dates;
  }

  private daysAgo(days: number, from = new Date()) {
    return this.startOfDay(this.addDays(from, -days));
  }

  private addDays(value: Date, days: number) {
    const next = new Date(value);
    next.setDate(next.getDate() + days);
    return next;
  }

  private startOfDay(value: Date) {
    const next = new Date(value);
    next.setHours(0, 0, 0, 0);
    return next;
  }

  private endOfDay(value: Date) {
    const next = new Date(value);
    next.setHours(23, 59, 59, 999);
    return next;
  }

  private toDateKey(value: string | Date) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().slice(0, 10);
  }
}
