import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Public, RequirePermissions, ResponseMessage, User } from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { PaymentCallbackDto } from './dto/payment-callback.dto';
import { OrdersService } from './orders.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('orders/:orderId/initiate')
  @ResponseMessage('Initiate payment')
  initiatePayment(
    @User() currentUser: IUser,
    @Param('orderId') orderId: string,
    @Body() initiatePaymentDto: InitiatePaymentDto,
  ) {
    return this.ordersService.initiatePayment(
      currentUser,
      orderId,
      initiatePaymentDto,
    );
  }

  @Public()
  @Post('callback/:provider')
  @ResponseMessage('Handle payment callback')
  handlePaymentCallback(
    @Param('provider') provider: string,
    @Body() paymentCallbackDto: PaymentCallbackDto,
  ) {
    return this.ordersService.handlePaymentCallback(
      provider,
      paymentCallbackDto,
    );
  }

  @Get('orders/:orderId/transactions')
  @ResponseMessage('Get order payment transactions')
  getPaymentTransactions(
    @User() currentUser: IUser,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.findPaymentTransactions(currentUser, orderId);
  }

  @Public()
  @Post('momo/ipn')
  @ResponseMessage('MoMo IPN received')
  handleMomoIpn(@Body() body: Record<string, unknown>) {
    return this.ordersService.handleMomoIpn(body);
  }

  @Public()
  @Post('momo/verify')
  @ResponseMessage('MoMo payment verified')
  verifyMomoRedirect(@Body() body: Record<string, unknown>) {
    // Reuse IPN handler — same payload shape from MoMo redirect params
    return this.ordersService.handleMomoIpn(body);
  }

  @RequirePermissions('manage_orders')
  @Get('admin/transactions')
  @ResponseMessage('Get all payment transactions')
  getAllTransactions(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('provider') provider?: string,
    @Query('status') status?: string,
  ) {
    return this.ordersService.findAllPaymentTransactions({
      page: Math.max(1, parseInt(page, 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 20)),
      provider,
      status,
    });
  }
}
