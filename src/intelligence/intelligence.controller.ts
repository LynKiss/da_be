import { Controller, Get, Query } from '@nestjs/common';
import {
  Public,
  RequirePermissions,
  ResponseMessage,
} from '../decorator/customize';
import { QueryDemandForecastDto } from './dto/query-demand-forecast.dto';
import { QueryProductRecommendationsDto } from './dto/query-product-recommendations.dto';
import { QueryReorderSuggestionsDto } from './dto/query-reorder-suggestions.dto';
import { IntelligenceService } from './intelligence.service';

@Controller('intelligence')
export class IntelligenceController {
  constructor(private readonly intelligenceService: IntelligenceService) {}

  @Public()
  @Get('product-recommendations')
  @ResponseMessage('Get product recommendations')
  getProductRecommendations(@Query() query: QueryProductRecommendationsDto) {
    return this.intelligenceService.getProductRecommendations(query);
  }

  @Get('reorder-suggestions')
  @RequirePermissions('manage_inventory')
  @ResponseMessage('Get reorder suggestions')
  getReorderSuggestions(@Query() query: QueryReorderSuggestionsDto) {
    return this.intelligenceService.getReorderSuggestions(query);
  }

  @Get('demand-forecast')
  @RequirePermissions('manage_inventory')
  @ResponseMessage('Get demand forecast')
  getDemandForecast(@Query() query: QueryDemandForecastDto) {
    return this.intelligenceService.getDemandForecast(query);
  }
}
