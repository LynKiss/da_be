import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  RequireAnyPermissions,
  ResponseMessage,
  User,
} from '../decorator/customize';
import {
  uploadImageToCloudinary,
  type UploadedImageFile,
} from './cloudinary.util';
import type { IUser } from '../users/users.interface';

@Controller('uploads')
export class UploadsController {
  @Post('rich-text-images')
  @RequireAnyPermissions('manage_products', 'manage_news', 'manage_interface')
  @UseInterceptors(FileInterceptor('file'))
  @ResponseMessage('Rich text image uploaded')
  async uploadRichTextImage(
    @User() currentUser: IUser,
    @UploadedFile() file: UploadedImageFile | undefined,
  ) {
    const url = await uploadImageToCloudinary(file, {
      folder: 'agri_ecommerce/rich_text',
      publicIdPrefix: `rich-text-${currentUser._id}`,
      maxBytes: 5 * 1024 * 1024,
    });

    return { url };
  }
}
