import { Body, Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { RequirePermissions, ResponseMessage } from '../decorator/customize';
import { ApplyPriceDto, CalcPriceSuggestionDto } from './dto/price-suggestion.dto';
import { PricingService } from './pricing.service';

function getPerformer(req: any, ip?: string) {
  const user = req.user;
  if (!user?._id) return undefined;
  return { userId: user._id as string, username: user.username as string, ip };
}

function getIp(req: any): string | undefined {
  return (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? undefined;
}

@Controller('pricing')
export class PricingController {
  constructor(private readonly service: PricingService) {}

  @Get('suggestions')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get price suggestions')
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(Number(page ?? 1), Number(limit ?? 20));
  }

  @Get('suggestions/product/:productId')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get suggestions by product')
  findByProduct(@Param('productId') productId: string) {
    return this.service.findByProduct(productId);
  }

  @Post('suggestions/preview')
  @RequirePermissions('manage_products')
  @ResponseMessage('Preview price calculation')
  preview(@Body() dto: CalcPriceSuggestionDto) {
    return this.service.preview(dto);
  }

  @Post('suggestions/calculate')
  @RequirePermissions('manage_products')
  @ResponseMessage('Calculate and save price suggestion')
  calculate(@Body() dto: CalcPriceSuggestionDto, @Request() req: any) {
    return this.service.calculate(dto, req.user?._id);
  }

  @Post('suggestions/:id/apply')
  @RequirePermissions('manage_products')
  @ResponseMessage('Apply price to product')
  applyPrice(
    @Param('id') id: string,
    @Body() dto: ApplyPriceDto,
    @Request() req: any,
  ) {
    return this.service.applyPrice(id, dto, req.user?._id, getPerformer(req, getIp(req)));
  }
}
