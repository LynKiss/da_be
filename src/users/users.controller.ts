import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  RequirePermissions,
  ResponseMessage,
  User,
} from '../decorator/customize';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { CreateShippingAddressDto } from './dto/create-shipping-address.dto';
import { QueryAdminUsersDto } from './dto/query-admin-users.dto';
import { ResetAdminUserPasswordDto } from './dto/reset-admin-user-password.dto';
import { UpdateShippingAddressDto } from './dto/update-shipping-address.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { UpdateAdminUserStatusDto } from './dto/update-admin-user-status.dto';
import type { IUser } from './users.interface';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions('manage_users')
  @ResponseMessage('Get users list')
  getUsers(@Query() query: QueryAdminUsersDto) {
    return this.usersService.findAll(query);
  }

  @Post('admin/customers')
  @RequirePermissions('manage_users')
  @ResponseMessage('Create customer account')
  createCustomer(
    @User() currentUser: IUser,
    @Body() createAdminUserDto: CreateAdminUserDto,
  ) {
    return this.usersService.createAdminUser(currentUser._id, createAdminUserDto);
  }

  @Get('admin/customers/:id')
  @RequirePermissions('manage_users')
  @ResponseMessage('Get customer detail')
  getCustomerDetail(@Param('id') id: string) {
    return this.usersService.findAdminUserDetail(id);
  }

  @Patch('admin/customers/:id')
  @RequirePermissions('manage_users')
  @ResponseMessage('Update customer account')
  updateCustomer(
    @User() currentUser: IUser,
    @Param('id') id: string,
    @Body() updateAdminUserDto: UpdateAdminUserDto,
  ) {
    return this.usersService.updateAdminUser(currentUser._id, id, updateAdminUserDto);
  }

  @Patch('admin/customers/:id/status')
  @RequirePermissions('manage_users')
  @ResponseMessage('Update customer status')
  updateCustomerStatus(
    @User() currentUser: IUser,
    @Param('id') id: string,
    @Body() updateAdminUserStatusDto: UpdateAdminUserStatusDto,
  ) {
    return this.usersService.updateAdminUserStatus(
      currentUser._id,
      id,
      updateAdminUserStatusDto,
    );
  }

  @Patch('admin/customers/:id/reset-password')
  @RequirePermissions('manage_users')
  @ResponseMessage('Reset customer password')
  resetCustomerPassword(
    @User() currentUser: IUser,
    @Param('id') id: string,
    @Body() resetAdminUserPasswordDto: ResetAdminUserPasswordDto,
  ) {
    return this.usersService.resetAdminUserPassword(
      currentUser._id,
      id,
      resetAdminUserPasswordDto,
    );
  }

  @Delete('admin/customers/:id')
  @RequirePermissions('manage_users')
  @ResponseMessage('Delete customer account')
  deleteCustomer(@User() currentUser: IUser, @Param('id') id: string) {
    return this.usersService.deleteAdminUser(currentUser._id, id);
  }

  @Get('me')
  @ResponseMessage('Get my profile')
  getMyProfile(@User() currentUser: IUser) {
    return this.usersService.findProfile(currentUser._id);
  }

  @Patch('me')
  @ResponseMessage('Update my profile')
  updateMyProfile(
    @User() currentUser: IUser,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.updateProfile(currentUser._id, updateUserDto);
  }

  @Patch('me/change-password')
  @ResponseMessage('Change password')
  changeMyPassword(
    @User() currentUser: IUser,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(currentUser._id, changePasswordDto);
  }

  @Get('me/addresses')
  @ResponseMessage('Get my shipping addresses')
  getMyShippingAddresses(@User() currentUser: IUser) {
    return this.usersService.findMyShippingAddresses(currentUser._id);
  }

  @Post('me/addresses')
  @ResponseMessage('Create my shipping address')
  createMyShippingAddress(
    @User() currentUser: IUser,
    @Body() createShippingAddressDto: CreateShippingAddressDto,
  ) {
    return this.usersService.createShippingAddress(
      currentUser._id,
      createShippingAddressDto,
    );
  }

  @Patch('me/addresses/:id')
  @ResponseMessage('Update my shipping address')
  updateMyShippingAddress(
    @User() currentUser: IUser,
    @Param('id') id: string,
    @Body() updateShippingAddressDto: UpdateShippingAddressDto,
  ) {
    return this.usersService.updateShippingAddress(
      currentUser._id,
      id,
      updateShippingAddressDto,
    );
  }

  @Delete('me/addresses/:id')
  @ResponseMessage('Delete my shipping address')
  deleteMyShippingAddress(@User() currentUser: IUser, @Param('id') id: string) {
    return this.usersService.deleteShippingAddress(currentUser._id, id);
  }

  @Patch('me/addresses/:id/default')
  @ResponseMessage('Set my default shipping address')
  setMyDefaultShippingAddress(
    @User() currentUser: IUser,
    @Param('id') id: string,
  ) {
    return this.usersService.setDefaultShippingAddress(currentUser._id, id);
  }

  @Get('me/orders')
  @ResponseMessage('Get my orders')
  getMyOrders(@User() currentUser: IUser) {
    return this.usersService.findMyOrders(currentUser._id);
  }

  @Get('me/orders/:id')
  @ResponseMessage('Get my order detail')
  getMyOrderDetail(@User() currentUser: IUser, @Param('id') id: string) {
    return this.usersService.findMyOrderDetail(currentUser._id, id);
  }
}
