import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  RequirePermissions,
  ResponseMessage,
  User,
} from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactStatusDto } from './dto/update-contact-status.dto';
import { ContactsService } from './contacts.service';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  @ResponseMessage('Create contact')
  createContact(
    @User() currentUser: IUser,
    @Body() createContactDto: CreateContactDto,
  ) {
    return this.contactsService.create(currentUser, createContactDto);
  }

  @Get('my')
  @ResponseMessage('Get my contacts')
  getMyContacts(@User() currentUser: IUser) {
    return this.contactsService.findMine(currentUser._id);
  }

  @Get()
  @RequirePermissions('manage_users')
  @ResponseMessage('Get contacts list')
  getContacts() {
    return this.contactsService.findAll();
  }

  @Get(':id')
  @ResponseMessage('Get contact detail')
  getContact(@Param('id') id: string, @User() currentUser: IUser) {
    const canManage = currentUser.permissions.some(
      (permission) => permission.key === 'manage_users',
    );

    return this.contactsService.findOne(id, currentUser, canManage);
  }

  @Patch(':id/status')
  @RequirePermissions('manage_users')
  @ResponseMessage('Update contact status')
  updateContactStatus(
    @Param('id') id: string,
    @Body() updateContactStatusDto: UpdateContactStatusDto,
  ) {
    return this.contactsService.updateStatus(id, updateContactStatusDto);
  }
}
