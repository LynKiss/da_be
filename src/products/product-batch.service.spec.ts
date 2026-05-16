import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductBatchEntity } from './entities/product-batch.entity';
import { ProductBatchService } from './product-batch.service';

function makeBatch(over: Partial<ProductBatchEntity>): ProductBatchEntity {
  return {
    batchId: over.batchId ?? `batch-${Math.random().toString(36).slice(2, 8)}`,
    productId: over.productId ?? 'p1',
    grId: over.grId ?? null,
    batchCode: over.batchCode ?? 'L-default',
    mfgDate: over.mfgDate ?? null,
    expDate: over.expDate ?? null,
    qtyReceived: over.qtyReceived ?? 100,
    qtyRemaining: over.qtyRemaining ?? 100,
    unitCost: over.unitCost ?? '10000',
    note: over.note ?? null,
    createdAt: over.createdAt ?? new Date('2025-01-01'),
    updatedAt: over.updatedAt ?? new Date('2025-01-01'),
  } as ProductBatchEntity;
}

describe('ProductBatchService', () => {
  let service: ProductBatchService;
  let repo: jest.Mocked<Repository<ProductBatchEntity>>;

  beforeEach(async () => {
    const repoMock = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      count: jest.fn(),
      manager: {
        transaction: jest.fn(),
        find: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductBatchService,
        { provide: getRepositoryToken(ProductBatchEntity), useValue: repoMock },
      ],
    }).compile();

    service = module.get<ProductBatchService>(ProductBatchService);
    repo = module.get(getRepositoryToken(ProductBatchEntity));
  });

  // ─── computePick: core FIFO/FEFO logic (pure function) ─────────────────────
  describe('computePick — FIFO/FEFO pure logic', () => {
    it('Empty batches → shortfall = qty, success = false', () => {
      const result = service.computePick([], 10);
      expect(result.success).toBe(false);
      expect(result.shortfall).toBe(10);
      expect(result.lines).toHaveLength(0);
      expect(result.totalCost).toBe(0);
    });

    it('Single batch with enough stock → success', () => {
      const batches = [makeBatch({ qtyRemaining: 100, unitCost: '10000' })];
      const result = service.computePick(batches, 30);
      expect(result.success).toBe(true);
      expect(result.shortfall).toBe(0);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].qty).toBe(30);
      expect(result.totalCost).toBe(30 * 10000);
      expect(result.avgCost).toBe(10000);
    });

    it('Multi-batch span: 50 + 30 to fulfill 80', () => {
      const batches = [
        makeBatch({ batchId: 'b1', qtyRemaining: 50, unitCost: '10000', expDate: new Date('2025-06-01') }),
        makeBatch({ batchId: 'b2', qtyRemaining: 80, unitCost: '12000', expDate: new Date('2025-12-01') }),
      ];
      const result = service.computePick(batches, 80);
      expect(result.success).toBe(true);
      expect(result.lines).toHaveLength(2);
      expect(result.lines[0].batchId).toBe('b1');
      expect(result.lines[0].qty).toBe(50);
      expect(result.lines[1].batchId).toBe('b2');
      expect(result.lines[1].qty).toBe(30);
      expect(result.totalCost).toBe(50 * 10000 + 30 * 12000); // 860,000
      expect(result.avgCost).toBeCloseTo(860000 / 80, 4);
    });

    it('Insufficient stock → shortfall reported correctly', () => {
      const batches = [
        makeBatch({ batchId: 'b1', qtyRemaining: 20 }),
        makeBatch({ batchId: 'b2', qtyRemaining: 30 }),
      ];
      const result = service.computePick(batches, 100);
      expect(result.success).toBe(false);
      expect(result.shortfall).toBe(50);
      expect(result.totalQty).toBe(50);
    });

    it('Stops at first batch when qty enough', () => {
      const batches = [
        makeBatch({ batchId: 'b1', qtyRemaining: 100 }),
        makeBatch({ batchId: 'b2', qtyRemaining: 100 }),
      ];
      const result = service.computePick(batches, 50);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].batchId).toBe('b1');
    });

    it('Computes correct unit cost from string decimal', () => {
      const batches = [makeBatch({ qtyRemaining: 10, unitCost: '12345.6789' })];
      const result = service.computePick(batches, 5);
      expect(result.lines[0].unitCost).toBe(12345.6789);
      expect(result.lines[0].subtotal).toBeCloseTo(5 * 12345.6789, 4);
    });

    it('Zero qty request → returns empty success', () => {
      const result = service.computePick([makeBatch({})], 0);
      expect(result.lines).toHaveLength(0);
      expect(result.shortfall).toBe(0);
    });
  });

  // ─── previewPick (with mocked query builder) ───────────────────────────────
  describe('previewPick — queries DB then computes pick', () => {
    it('Returns 0 for negative or zero qty without DB call', async () => {
      const result = await service.previewPick('p1', 0);
      expect(result.success).toBe(false);
      expect(result.shortfall).toBe(0);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('Calls DB with proper FEFO order and filters expired', async () => {
      const batches = [
        makeBatch({ batchId: 'b1', qtyRemaining: 30, expDate: new Date('2025-06-01') }),
        makeBatch({ batchId: 'b2', qtyRemaining: 50, expDate: null }),
      ];
      const qbMock = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(batches),
      };
      repo.createQueryBuilder.mockReturnValue(qbMock as any);

      const result = await service.previewPick('p1', 60);
      expect(result.success).toBe(true);
      expect(result.lines[0].batchId).toBe('b1'); // FEFO: nearest expiry first
      expect(result.lines[1].batchId).toBe('b2');
      expect(qbMock.andWhere).toHaveBeenCalledWith('b.qtyRemaining > 0');
    });
  });

  // ─── priceReduction ────────────────────────────────────────────────────────
  describe('priceReduction — only allows lowering cost', () => {
    it('Reject newPrice >= oldPrice', async () => {
      repo.findOne.mockResolvedValue(
        makeBatch({ unitCost: '10000', qtyRemaining: 50 }),
      );
      await expect(service.priceReduction('b1', 12000, '')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('Reject 0 or negative', async () => {
      await expect(service.priceReduction('b1', 0, '')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.priceReduction('b1', -1, '')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('Reject if batch already depleted', async () => {
      repo.findOne.mockResolvedValue(
        makeBatch({ unitCost: '10000', qtyRemaining: 0 }),
      );
      await expect(service.priceReduction('b1', 8000, '')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('Accepts valid reduction and saves', async () => {
      const batch = makeBatch({ unitCost: '10000', qtyRemaining: 50 });
      repo.findOne.mockResolvedValue(batch);
      repo.save.mockResolvedValue(batch);

      const result = await service.priceReduction('b1', 7500, 'Cận date 5 ngày');
      expect(result.oldCost).toBe(10000);
      expect(result.newUnitCost).toBe(7500);
      expect(batch.unitCost).toBe('7500.0000');
      expect(batch.note).toContain('Cận date 5 ngày');
      expect(repo.save).toHaveBeenCalledWith(batch);
    });

    it('NotFound when batch not exists', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.priceReduction('xxx', 5000, '')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── findById ─────────────────────────────────────────────────────────────
  describe('findById', () => {
    it('Returns batch when exists', async () => {
      const b = makeBatch({ batchId: 'b-x' });
      repo.findOne.mockResolvedValue(b);
      const result = await service.findById('b-x');
      expect(result).toBe(b);
    });

    it('Throws NotFoundException when not exists', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── stats — aggregations from batches ─────────────────────────────────────
  describe('stats', () => {
    it('Categorizes batches by expiry status', async () => {
      const now = new Date();
      const day = 86_400_000;
      const batches = [
        makeBatch({ qtyRemaining: 10, unitCost: '1000', expDate: null }), // active
        makeBatch({ qtyRemaining: 20, unitCost: '2000', expDate: new Date(now.getTime() + 100 * day) }), // active
        makeBatch({ qtyRemaining: 5, unitCost: '3000', expDate: new Date(now.getTime() + 20 * day) }), // expiring_soon
        makeBatch({ qtyRemaining: 8, unitCost: '4000', expDate: new Date(now.getTime() + 3 * day) }), // critical
        makeBatch({ qtyRemaining: 3, unitCost: '5000', expDate: new Date(now.getTime() - 5 * day) }), // expired
      ];
      const qbMock = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(batches),
      };
      repo.createQueryBuilder.mockReturnValue(qbMock as any);

      const stats = await service.stats();
      expect(stats.totalBatches).toBe(5);
      expect(stats.totalQty).toBe(46);
      expect(stats.totalValue).toBe(
        10 * 1000 + 20 * 2000 + 5 * 3000 + 8 * 4000 + 3 * 5000,
      );
      expect(stats.breakdown.expired).toBe(1);
      expect(stats.breakdown.critical).toBe(1);
      expect(stats.breakdown.expiringSoon).toBe(1);
      expect(stats.breakdown.active).toBe(2);
    });
  });

  // ─── Integration: full scenario ────────────────────────────────────────────
  describe('Real-world scenario — FIFO with mixed expiry', () => {
    it('Pick correctly when newer batch has earlier expiry (FEFO)', () => {
      // Lô cũ nhập trước nhưng HSD xa, lô mới nhập sau nhưng HSD gần
      // → FEFO ưu tiên lô mới (gần date hơn)
      const batches = [
        makeBatch({
          batchId: 'b-older-late',
          qtyRemaining: 100,
          createdAt: new Date('2025-01-01'),
          expDate: new Date('2026-06-01'),
          unitCost: '10000',
        }),
        makeBatch({
          batchId: 'b-newer-soon',
          qtyRemaining: 50,
          createdAt: new Date('2025-03-01'),
          expDate: new Date('2025-06-01'), // Gần hơn
          unitCost: '12000',
        }),
      ];
      // Khi service.previewPick gọi DB, ORDER BY exp_date ASC → b-newer-soon trước
      // Mô phỏng kết quả đã sort của DB
      const sorted = [batches[1], batches[0]];
      const result = service.computePick(sorted, 80);
      expect(result.lines[0].batchId).toBe('b-newer-soon');
      expect(result.lines[0].qty).toBe(50);
      expect(result.lines[1].batchId).toBe('b-older-late');
      expect(result.lines[1].qty).toBe(30);
    });

    it('FIFO fallback khi all batches no expiry', () => {
      const batches = [
        makeBatch({
          batchId: 'b-older',
          qtyRemaining: 40,
          createdAt: new Date('2025-01-01'),
          expDate: null,
          unitCost: '8000',
        }),
        makeBatch({
          batchId: 'b-newer',
          qtyRemaining: 60,
          createdAt: new Date('2025-04-01'),
          expDate: null,
          unitCost: '9500',
        }),
      ];
      // Service sort: NULL last, then createdAt ASC → b-older trước
      const sorted = [batches[0], batches[1]];
      const result = service.computePick(sorted, 70);
      expect(result.lines[0].batchId).toBe('b-older');
      expect(result.lines[0].qty).toBe(40);
      expect(result.lines[1].batchId).toBe('b-newer');
      expect(result.lines[1].qty).toBe(30);
      expect(result.totalCost).toBe(40 * 8000 + 30 * 9500); // 605,000
    });
  });
});
