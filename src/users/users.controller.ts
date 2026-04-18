import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  RequirePermissions,
  ResponseMessage,
  User,
} from '../decorator/customize';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateShippingAddressDto } from './dto/create-shipping-address.dto';
import { UpdateShippingAddressDto } from './dto/update-shipping-address.dto';
import type { IUser } from './users.interface';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions('manage_users')
  @ResponseMessage('Get users list')
  getUsers() {
    return this.usersService.findAll();
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
