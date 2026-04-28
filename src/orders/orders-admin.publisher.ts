import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import {
  ORDERS_ADMIN_NEW_EVENT,
  ORDERS_ADMIN_ROOM,
} from './orders-admin-realtime.constants';
import { OrderEntity } from './entities/order.entity';

export type AdminNewOrderPayload = {
  orderId: string;
  fullName: string;
  phone: string;
  totalPayment: string;
  status: string;
  paymentStatus: string;
  createdAt: Date;
};

@Injectable()
export class OrdersAdminPublisher {
  private server: Server | null = null;

  attach(server: Server) {
    this.server = server;
  }

  emitNewOrder(order: OrderEntity) {
    if (!this.server) {
      return;
    }

    const payload: AdminNewOrderPayload = {
      orderId: order.orderId,
      fullName: order.fullName,
      phone: order.phone,
      totalPayment: order.totalPayment,
      status: order.orderStatus,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt,
    };

    this.server.to(ORDERS_ADMIN_ROOM).emit(ORDERS_ADMIN_NEW_EVENT, payload);
  }
}
