import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { basename, extname } from 'node:path';
import sharp from 'sharp';

export const MAX_UPLOAD_FILES = 6;
export const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_WIDTH = 8_000;
export const MAX_IMAGE_HEIGHT = 8_000;
export const MAX_IMAGE_PIXELS = 40_000_000;

type SupportedImage = {
  extension: 'jpg' | 'png' | 'webp';
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
};

const TYPES_BY_EXTENSION: Record<string, SupportedImage> = {
  '.jpg': { extension: 'jpg', contentType: 'image/jpeg' },
  '.jpeg': { extension: 'jpg', contentType: 'image/jpeg' },
  '.png': { extension: 'png', contentType: 'image/png' },
  '.webp': { extension: 'webp', contentType: 'image/webp' },
};

const TYPES_BY_MIME: ReadonlyMap<string, SupportedImage> = new Map(
  Object.values(TYPES_BY_EXTENSION).map((type) => [type.contentType, type]),
);

/** Multer rejects excess data while streaming, before the full buffer is held. */
export const IMAGE_UPLOAD_MULTER_OPTIONS: MulterOptions = {
  limits: {
    fileSize: MAX_UPLOAD_FILE_BYTES,
    files: MAX_UPLOAD_FILES,
    fields: 0,
    parts: MAX_UPLOAD_FILES,
    fieldNameSize: 100,
    headerPairs: 50,
  },
  fileFilter: (_request, file, callback) => {
    try {
      validateDeclaredFileIdentity(file.originalname, file.mimetype);
      callback(null, true);
    } catch (error) {
      callback(error as Error, false);
    }
  },
};

function safeDisplayName(originalName: string): string {
  return basename(originalName.replaceAll('\\', '/')).slice(0, 120) || 'upload';
}

function validateDeclaredFileIdentity(originalName: string, mimeType: string): SupportedImage {
  if (!originalName || originalName.includes('\0') || originalName.length > 255) {
    throw new BadRequestException('Invalid upload filename');
  }

  const typeFromExtension = TYPES_BY_EXTENSION[extname(originalName).toLowerCase()];
  const typeFromMime = TYPES_BY_MIME.get(mimeType.toLowerCase());
  if (!typeFromExtension || !typeFromMime || typeFromExtension.contentType !== typeFromMime.contentType) {
    throw new BadRequestException(
      `"${safeDisplayName(originalName)}": extension and MIME must describe PNG, JPEG or WebP`,
    );
  }
  return typeFromExtension;
}

function detectMagicBytes(buffer: Buffer): SupportedImage | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return TYPES_BY_EXTENSION['.png'];
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return TYPES_BY_EXTENSION['.jpg'];
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return TYPES_BY_EXTENSION['.webp'];
  }
  return null;
}

/**
 * Validates claims, signature, decoded format, dimensions and pixel count.
 * `stats()` forces libvips to decode the pixels, rejecting truncated/corrupt
 * payloads that can still have a superficially valid header.
 */
export async function validateImageUpload(file: Express.Multer.File): Promise<SupportedImage> {
  const displayName = safeDisplayName(file.originalname);
  if (!file.buffer?.length) throw new BadRequestException(`"${displayName}": empty file`);
  if (file.size !== file.buffer.length || file.size > MAX_UPLOAD_FILE_BYTES) {
    throw new PayloadTooLargeException(`"${displayName}" exceeds the 5MB limit`);
  }

  const declaredType = validateDeclaredFileIdentity(file.originalname, file.mimetype);
  const detectedType = detectMagicBytes(file.buffer);
  if (!detectedType || detectedType.contentType !== declaredType.contentType) {
    throw new BadRequestException(`"${displayName}": file content does not match its type`);
  }

  try {
    const image = sharp(file.buffer, {
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== detectedType.extension.replace('jpg', 'jpeg') ||
      !metadata.width ||
      !metadata.height
    ) {
      throw new Error('Unsupported or dimensionless image');
    }
    if ((metadata.pages ?? 1) !== 1) {
      throw new Error('Animated or multi-page images are not supported');
    }
    if (metadata.width > MAX_IMAGE_WIDTH || metadata.height > MAX_IMAGE_HEIGHT) {
      throw new Error(`Image dimensions exceed ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}`);
    }
    if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
      throw new Error(`Image exceeds ${MAX_IMAGE_PIXELS} decoded pixels`);
    }
    await image.stats();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'decode failed';
    throw new BadRequestException(`"${displayName}": invalid image (${reason})`);
  }

  return detectedType;
}

export function safePhotoStorageKey(
  brandId: string,
  modelSlug: string,
  extension: SupportedImage['extension'],
  objectId: string,
): string {
  const safeSegment = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/i;
  if (!safeSegment.test(brandId) || !safeSegment.test(modelSlug) || !/^[0-9a-f-]{36}$/i.test(objectId)) {
    throw new BadRequestException('Unsafe photo storage key');
  }
  return `${brandId}/${modelSlug}/${objectId}.${extension}`;
}
