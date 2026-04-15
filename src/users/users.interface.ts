import { UserRole } from './entities/user.entity';

export interface IUserPermission {
  _id: string;
  key: string;
  name: string;
}

export interface IUserRoleSummary {
  _id: UserRole;
  name: UserRole;
}

export interface IUser {
  _id: string;
  username: string;
  email: string;
  avatarUrl?: string | null;
  role: IUserRoleSummary;
  permissions: IUserPermission[];
}
