import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public, ResponseMessage, User } from '../decorator/customize';
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
}
