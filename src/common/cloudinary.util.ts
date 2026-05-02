import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

export interface UploadedImageFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Upload 1 file ảnh lên Cloudinary với folder + publicId tuỳ chỉnh.
 * Trả về secure_url.
 */
export async function uploadImageToCloudinary(
  file: UploadedImageFile | undefined,
  options: {
    folder: string;
    publicIdPrefix: string;
    maxBytes?: number;
  },
): Promise<string> {
  if (!file) {
    throw new BadRequestException('Image file is required');
  }
  if (!file.mimetype?.startsWith('image/')) {
    throw new BadRequestException('Only image files are allowed');
  }
  const maxBytes = options.maxBytes ?? MAX_SIZE_BYTES;
  if (file.size > maxBytes) {
    throw new BadRequestException(
      `Image size must be ${Math.round(maxBytes / 1024 / 1024)}MB or less`,
    );
  }

  const cloudName = process.env.CLOUD_NAME;
  const apiKey = process.env.API_KEY;
  const apiSecret = process.env.API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new InternalServerErrorException(
      'Cloudinary environment variables are missing',
    );
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `${options.publicIdPrefix}-${Date.now()}`;
  const signature = createHash('sha1')
    .update(
      `folder=${options.folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`,
    )
    .digest('hex');

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
    file.originalname,
  );
  formData.append('api_key', apiKey);
  formData.append('timestamp', String(timestamp));
  formData.append('signature', signature);
  formData.append('folder', options.folder);
  formData.append('public_id', publicId);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: 'POST', body: formData },
  );

  const payload = (await response.json()) as {
    secure_url?: string;
    error?: { message?: string };
  };

  if (!response.ok || !payload.secure_url) {
    throw new InternalServerErrorException(
      payload.error?.message ?? 'Unable to upload image to Cloudinary',
    );
  }

  return payload.secure_url;
}
