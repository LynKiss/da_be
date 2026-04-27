import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { RolesService } from '../roles/roles.service';
import { UserRole } from '../users/entities/user.entity';
import type { IUser } from '../users/users.interface';
import {
  DASHBOARD_ERROR_EVENT,
  DASHBOARD_NAMESPACE,
  DASHBOARD_ROOM,
} from './dashboard-realtime.constants';
import { DashboardPublisher } from './dashboard.publisher';

type JwtPayload = {
  _id: string;
  username: string;
  email: string;
  role: {
    _id: UserRole;
    name: UserRole;
  };
};

@WebSocketGateway({
  namespace: DASHBOARD_NAMESPACE,
  cors: {
    origin: true,
    credentials: true,
  },
})
export class DashboardGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  private server: Server;

  private readonly logger = new Logger(DashboardGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly rolesService: RolesService,
    private readonly dashboardPublisher: DashboardPublisher,
  ) {}

  afterInit(server: Server) {
    this.dashboardPublisher.attach(server);
  }

  async handleConnection(client: Socket) {
    try {
      const currentUser = await this.authenticateClient(client);
      (client.data as { user?: IUser }).user = currentUser;
      void client.join(DASHBOARD_ROOM);
      await this.dashboardPublisher.emitSnapshot(client);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Socket authentication failed';
      this.logger.warn(`Reject dashboard socket ${client.id}: ${message}`);
      client.emit(DASHBOARD_ERROR_EVENT, { message });
      client.disconnect();
    }
  }

  @SubscribeMessage('dashboard:refresh')
  async handleRefresh(@ConnectedSocket() client: Socket) {
    this.getCurrentUser(client);
    await this.dashboardPublisher.emitSnapshot(client, 'manual_refresh');
  }

  private getCurrentUser(client: Socket) {
    const currentUser = (client.data as { user?: IUser }).user;

    if (!currentUser) {
      throw new UnauthorizedException('Socket user is missing');
    }

    return currentUser;
  }

  private async authenticateClient(client: Socket): Promise<IUser> {
    const token = this.extractToken(client);

    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    const role = payload.role?._id
      ? await this.rolesService.findOne(payload.role._id)
      : null;

    const currentUser: IUser = {
      _id: payload._id,
      username: payload.username,
      email: payload.email,
      role: payload.role,
      permissions: role?.permissions ?? [],
    };

    const canViewReports = currentUser.permissions.some(
      (permission) => permission.key === 'manage_reports',
    );

    if (!canViewReports) {
      throw new ForbiddenException('You cannot access dashboard realtime');
    }

    return currentUser;
  }

  private extractToken(client: Socket) {
    const authToken =
      typeof client.handshake.auth?.token === 'string'
        ? client.handshake.auth.token
        : null;
    const authorizationHeader = client.handshake.headers.authorization;

    if (authToken) {
      return authToken.replace(/^Bearer\s+/i, '').trim();
    }

    if (typeof authorizationHeader === 'string') {
      return authorizationHeader.replace(/^Bearer\s+/i, '').trim();
    }

    return null;
  }
}
