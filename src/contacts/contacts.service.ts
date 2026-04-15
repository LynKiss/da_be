import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { IUser } from '../users/users.interface';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactStatusDto } from './dto/update-contact-status.dto';
import { ContactEntity } from './entities/contact.entity';

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(ContactEntity)
    private readonly contactsRepository: Repository<ContactEntity>,
  ) {}

  async create(currentUser: IUser, createContactDto: CreateContactDto) {
    const contact = this.contactsRepository.create({
      userId: currentUser._id,
      subject: createContactDto.subject,
      message: createContactDto.message,
    });

    return this.contactsRepository.save(contact);
  }

  async findAll() {
    return this.contactsRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findMine(userId: string) {
    return this.contactsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(contactId: string, currentUser: IUser, canManage: boolean) {
    const contact = await this.contactsRepository.findOneBy({ contactId });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    if (!canManage && contact.userId !== currentUser._id) {
      throw new ForbiddenException('You cannot access this contact');
    }

    return contact;
  }

  async updateStatus(
    contactId: string,
    updateContactStatusDto: UpdateContactStatusDto,
  ) {
    const contact = await this.contactsRepository.findOneBy({ contactId });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    contact.status = updateContactStatusDto.status;
    return this.contactsRepository.save(contact);
  }
}
