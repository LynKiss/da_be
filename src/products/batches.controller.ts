import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import {
  RequirePermissions,
  ResponseMessage,
} from '../decorator/customize';
import {
  PreviewFifoDto,
  PriceReductionDto,
  QueryBatchesDto,
  QueryExpiringDto,
  WriteOffBatchDto,
} from './dto/batch.dto';
import { ProductBatchService } from './product-batch.service';

function getPerformer(req: any) {
  const user = req.user;
  if (!user?._id) return undefined;
  return { userId: user._id as string, username: user.username as string };
}

@Controller('inventory/batches')
export class BatchesController {
  constructor(private readonly batchService: ProductBatchService) {}

  /**
   * GET /inventory/batches?productId&includeDepleted
   * Liệt kê batch theo filter, sorted by exp_date ASC (FEFO).
   */
  @Get()
  @RequirePermissions('manage_inventory')
  @ResponseMessage('List product batches')
  list(@Query() q: QueryBatchesDto) {
    return this.batchService.findAll({
      productId: q.productId,
      includeDepleted: q.includeDepleted,
    });
  }

  /**
   * GET /inventory/batches/expiring?daysAhead=30
   * Lô sắp hết hạn (mặc định 30 ngày tới).
   */
  @Get('expiring')
  @RequirePermissions('manage_inventory')
  @ResponseMessage('List expiring batches')
  expiring(@Query() q: QueryExpiringDto) {
    return this.batchService.findExpiring(q.daysAhead ?? 30);
  }

  /**
   * GET /inventory/batches/expired
   * Lô đã hết hạn nhưng vẫn còn hàng (cần write-off).
   */
  @Get('expired')
  @RequirePermissions('manage_inventory')
  @ResponseMessage('List expired batches')
  expired() {
    return this.batchService.findExpired();
  }

  /**
   * GET /inventory/batches/stats?productId
   * Thống kê batch: count, total qty, value, breakdown by status.
   */
  @Get('stats')
  @RequirePermissions('manage_inventory')
  @ResponseMessage('Batch stats')
  stats(@Query('productId') productId?: string) {
    return this.batchService.stats(productId);
  }

  /**
   * POST /inventory/batches/backfill-legacy
   * MIGRATION (chạy 1 lần): tạo legacy batch cho mọi product có stock mà chưa có batch.
   * Idempotent — gọi nhiều lần vẫn an toàn.
   */
  @Post('backfill-legacy')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage_inventory')
  @ResponseMessage('Backfill legacy batches')
  backfillLegacy() {
    return this.batchService.backfillLegacyBatches();
  }

  /**
   * POST /inventory/batches/preview-fifo
   * Preview pick FIFO/FEFO trước khi xuất kho. Không thay đổi DB.
   */
  @Post('preview-fifo')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage_inventory')
  @ResponseMessage('Preview FIFO/FEFO pick')
  preview(@Body() dto: PreviewFifoDto) {
    return this.batchService.previewPick(dto.productId, dto.qty);
  }

  /**
   * GET /inventory/batches/:id
   */
  @Get(':id')
  @RequirePermissions('manage_inventory')
  @ResponseMessage('Get batch detail')
  detail(@Param('id') id: string) {
    return this.batchService.findById(id);
  }

  /**
   * POST /inventory/batches/:id/write-off
   * Hủy lô (qty còn → 0). Ghi nhận DAMAGE transaction với batchId.
   */
  @Post(':id/write-off')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage_inventory')
  @ResponseMessage('Write off batch')
  writeOff(
    @Param('id') id: string,
    @Body() dto: WriteOffBatchDto,
    @Request() req: any,
  ) {
    return this.batchService.writeOff(id, dto.reason, dto.notes ?? '', getPerformer(req));
  }

  /**
   * POST /inventory/batches/:id/price-reduction
   * Giảm đơn giá lô để bán nhanh hàng cận date.
   */
  @Post(':id/price-reduction')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage_inventory')
  @ResponseMessage('Reduce batch unit cost')
  priceReduction(
    @Param('id') id: string,
    @Body() dto: PriceReductionDto,
  ) {
    return this.batchService.priceReduction(id, dto.newUnitCost, dto.notes ?? '');
  }
}
