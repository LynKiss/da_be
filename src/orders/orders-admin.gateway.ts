import {
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { EffectivePermissionsService } from '../permissions/effective-permissions.service';
import { UserRole } from '../users/entities/user.entity';
import type { IUser } from '../users/users.interface';
import {
  ORDERS_ADMIN_ERROR_EVENT,
  ORDERS_ADMIN_NAMESPACE,
  ORDERS_ADMIN_ROOM,
} from './orders-admin-realtime.constants';
import { OrdersAdminPublisher } from './orders-admin.publisher';

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
  namespace: ORDERS_ADMIN_NAMESPACE,
  cors: {
    origin: true,
    credentials: true,
  },
})
export class OrdersAdminGateway
  implements OnGatewayInit, OnGatewayConnection
{
  @WebSocketServer()
  private server: Server;

  private readonly logger = new Logger(OrdersAdminGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly effectivePermissionsService: EffectivePermissionsService,
    private readonly ordersAdminPublisher: OrdersAdminPublisher,
  ) {}

  afterInit(server: Server) {
    this.ordersAdminPublisher.attach(server);
  }

  async handleConnection(client: Socket) {
    try {
      const currentUser = await this.authenticateClient(client);
      (client.data as { user?: IUser }).user = currentUser;
      void client.join(ORDERS_ADMIN_ROOM);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Socket authentication failed';
      this.logger.warn(`Reject orders admin socket ${client.id}: ${message}`);
      client.emit(ORDERS_ADMIN_ERROR_EVENT, { message });
      client.disconnect();
    }
  }

  private async authenticateClient(client: Socket): Promise<IUser> {
    const token = this.extractToken(client);

    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

    const currentUser: IUser = {
      _id: payload._id,
      username: payload.username,
      email: payload.email,
      role: payload.role,
      permissions: payload.role?._id
        ? await this.effectivePermissionsService.getEffectivePermissions(
            payload._id,
            payload.role._id,
          )
        : [],
    };

    const canManageOrders = currentUser.permissions.some(
      (permission) => permission.key === 'manage_orders',
    );

    if (!canManageOrders) {
      throw new ForbiddenException('You cannot access order realtime');
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
