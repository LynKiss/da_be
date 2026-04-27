import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntitySubscriberInterface,
  InsertEvent,
  RemoveEvent,
  SoftRemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { DashboardPublisher } from './dashboard.publisher';

@Injectable()
export class DashboardEventsSubscriber implements EntitySubscriberInterface {
  private readonly watchedTables = new Set([
    'orders',
    'order_items',
    'products',
    'inventory_transactions',
    'users',
    'discounts',
    'coupon_usage',
    'comments',
    'purchase_orders',
    'goods_receipts',
    'supplier_returns',
    'rice_diagnosis_history',
  ]);

  constructor(
    dataSource: DataSource,
    private readonly dashboardPublisher: DashboardPublisher,
  ) {
    dataSource.subscribers.push(this);
  }

  afterInsert(event: InsertEvent<unknown>) {
    this.notify('insert', event.metadata.tableName);
  }

  afterUpdate(event: UpdateEvent<unknown>) {
    this.notify('update', event.metadata.tableName);
  }

  afterRemove(event: RemoveEvent<unknown>) {
    this.notify('remove', event.metadata.tableName);
  }

  afterSoftRemove(event: SoftRemoveEvent<unknown>) {
    this.notify('soft_remove', event.metadata.tableName);
  }

  private notify(action: string, tableName?: string) {
    if (!tableName || !this.watchedTables.has(tableName)) {
      return;
    }

    this.dashboardPublisher.notifyChanged(`${tableName}:${action}`);
  }
}
