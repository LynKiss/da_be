import { Injectable, Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import {
  DASHBOARD_ERROR_EVENT,
  DASHBOARD_ROOM,
  DASHBOARD_SNAPSHOT_EVENT,
  DASHBOARD_UPDATED_EVENT,
} from './dashboard-realtime.constants';
import { ReportsService } from './reports.service';

@Injectable()
export class DashboardPublisher {
  private server: Server | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private pendingReasons = new Set<string>();
  private readonly logger = new Logger(DashboardPublisher.name);

  constructor(private readonly reportsService: ReportsService) {}

  attach(server: Server) {
    this.server = server;
  }

  async emitSnapshot(client: Socket, reason = 'initial') {
    const dashboard = await this.reportsService.getDashboard();
    client.emit(DASHBOARD_SNAPSHOT_EVENT, {
      reason,
      refreshedAt: new Date().toISOString(),
      dashboard,
    });
  }

  notifyChanged(reason = 'data_changed') {
    if (!this.server) {
      return;
    }

    this.pendingReasons.add(reason);

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      void this.flush();
    }, 350);
  }

  private async flush() {
    if (!this.server) {
      return;
    }

    const reasons = [...this.pendingReasons];
    this.pendingReasons.clear();
    this.refreshTimer = null;

    try {
      const dashboard = await this.reportsService.getDashboard();
      this.server.to(DASHBOARD_ROOM).emit(DASHBOARD_UPDATED_EVENT, {
        reason: reasons.join(',') || 'data_changed',
        refreshedAt: new Date().toISOString(),
        dashboard,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to refresh dashboard';
      this.logger.error(
        message,
        error instanceof Error ? error.stack : undefined,
      );
      this.server.to(DASHBOARD_ROOM).emit(DASHBOARD_ERROR_EVENT, { message });
    }
  }
}
