import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Public, RequirePermissions, ResponseMessage, User } from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { PaymentCallbackDto } from './dto/payment-callback.dto';
import { CreateCancelPaidRefundDto } from './dto/create-cancel-paid-refund.dto';
import { UpdateOrderRefundStatusDto } from './dto/update-order-refund-status.dto';
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
  @Post('guest/orders/:orderId/initiate')
  @ResponseMessage('Initiate guest payment')
  initiateGuestPayment(
    @Param('orderId') orderId: string,
    @Body() initiatePaymentDto: InitiatePaymentDto,
  ) {
    return this.ordersService.initiatePayment(
      undefined,
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

  @RequirePermissions('manage_payments')
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

  @RequirePermissions('manage_payments')
  @Get('admin/refunds')
  @ResponseMessage('Get refund queue')
  getAdminRefunds(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: string,
    @Query('reason') reason?: string,
    @Query('orderId') orderId?: string,
  ) {
    return this.ordersService.findAdminRefunds({
      page: Math.max(1, parseInt(page, 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 20)),
      status,
      reason,
      orderId,
    });
  }

  @RequirePermissions('manage_payments')
  @Post('admin/refunds/cancel-paid-order')
  @ResponseMessage('Create paid order cancellation refund')
  createCancelPaidOrderRefund(
    @User() currentUser: IUser,
    @Body() dto: CreateCancelPaidRefundDto,
  ) {
    return this.ordersService.createCancelPaidOrderRefund(currentUser, dto);
  }

  @RequirePermissions('manage_payments')
  @Patch('admin/refunds/:refundId/status')
  @ResponseMessage('Update refund status')
  updateRefundStatus(
    @User() currentUser: IUser,
    @Param('refundId') refundId: string,
    @Body() dto: UpdateOrderRefundStatusDto,
  ) {
    return this.ordersService.updateAdminRefundStatus(currentUser, refundId, dto);
  }
}
