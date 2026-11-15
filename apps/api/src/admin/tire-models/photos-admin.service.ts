import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { AdminPhoto } from '@tyre/shared';

import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { safePhotoStorageKey, validateImageUpload } from './image-upload.policy';
import { AuditContext } from '../../audit/audit-context';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class PhotosAdminService {
  private readonly logger = new Logger(PhotosAdminService.name);
  private readonly maxPerModel = Number(process.env.MAX_PHOTOS_PER_MODEL ?? 6);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private toAdminPhoto(p: { id: string; url: string; position: number }): AdminPhoto {
    return { id: p.id, url: this.storage.publicUrl(p.url), position: p.position };
  }

  /** Upload one or more photos; each is appended at the end of the order. */
  async upload(modelId: string, files: Express.Multer.File[], context: AuditContext): Promise<AdminPhoto[]> {
    if (!files || files.length === 0) throw new BadRequestException('No files provided');

    const model = await this.prisma.tireModel.findUnique({
      where: { id: modelId },
      include: { brand: { select: { id: true } }, _count: { select: { photos: true } } },
    });
    if (!model) throw new NotFoundException(`Tire model "${modelId}" not found`);

    if (model._count.photos + files.length > this.maxPerModel) {
      throw new ConflictException(
        `Model already has ${model._count.photos} photos; adding ${files.length} would exceed the limit of ${this.maxPerModel}`,
      );
    }

    const validatedFiles = await Promise.all(
      files.map(async (file) => ({ file, type: await validateImageUpload(file) })),
    );

    const uploaded: { key: string }[] = [];
    try {
      for (const { file, type } of validatedFiles) {
        const key = safePhotoStorageKey(model.brand.id, model.slug, type.extension, randomUUID());
        await this.storage.put(key, file.buffer, type.contentType);
        uploaded.push({ key });
      }
      return await this.prisma.$transaction(async (tx) => {
        const currentCount = await tx.tireModelPhoto.count({ where: { tireModelId: modelId } });
        if (currentCount + uploaded.length > this.maxPerModel) {
          throw new ConflictException(`Concurrent upload would exceed the limit of ${this.maxPerModel}`);
        }
        const rows = [];
        for (const [index, item] of uploaded.entries()) {
          rows.push(await tx.tireModelPhoto.create({
            data: { tireModelId: model.id, url: item.key, position: currentCount + index },
          }));
        }
        const result = rows.map((row) => this.toAdminPhoto(row));
        await this.audit.recordWithClient(tx, {
          ...context, action: 'catalog.photo.upload', entityType: 'TireModel', entityId: modelId,
          before: { photoCount: currentCount }, after: { photoCount: currentCount + rows.length, photos: result },
        });
        return result;
      });
    } catch (error) {
      await Promise.allSettled(uploaded.map(({ key }) => this.storage.remove(key)));
      throw error;
    }
  }

  /** Reorder: the id list must be exactly the model's photo set. */
  async reorder(modelId: string, photoIds: string[], context: AuditContext): Promise<AdminPhoto[]> {
    return this.prisma.$transaction(async (tx) => {
    const photos = await tx.tireModelPhoto.findMany({ where: { tireModelId: modelId }, orderBy: { position: 'asc' } });
    if (photos.length === 0 && photoIds.length === 0) return [];

    const current = new Set(photos.map((p) => p.id));
    const incoming = new Set(photoIds);
    if (current.size !== incoming.size || [...current].some((id) => !incoming.has(id))) {
      throw new BadRequestException('photoIds must contain exactly the model’s current photo ids');
    }

    for (const [index, id] of photoIds.entries()) {
      await tx.tireModelPhoto.update({ where: { id }, data: { position: index } });
    }
    const updated = await tx.tireModelPhoto.findMany({
      where: { tireModelId: modelId },
      orderBy: { position: 'asc' },
    });
    const result = updated.map((p) => this.toAdminPhoto(p));
    await this.audit.recordWithClient(tx, {
      ...context, action: 'catalog.photo.reorder', entityType: 'TireModel', entityId: modelId,
      before: photos.map((p) => ({ id: p.id, position: p.position })),
      after: updated.map((p) => ({ id: p.id, position: p.position })),
    });
    return result;
    });
  }

  /** Delete row + audit atomically, then best-effort cleanup the now-orphan object. */
  async remove(photoId: string, context: AuditContext): Promise<{ deleted: true }> {
    const photo = await this.prisma.$transaction(async (tx) => {
      const before = await tx.tireModelPhoto.findUnique({ where: { id: photoId } });
      if (!before) throw new NotFoundException(`Photo "${photoId}" not found`);
      await tx.tireModelPhoto.delete({ where: { id: photoId } });
      await tx.tireModelPhoto.updateMany({
        where: { tireModelId: before.tireModelId, position: { gt: before.position } },
        data: { position: { decrement: 1 } },
      });
      await this.audit.recordWithClient(tx, {
        ...context, action: 'catalog.photo.delete', entityType: 'TireModelPhoto', entityId: photoId,
        before, after: null,
      });
      return before;
    });
    await this.storage.remove(photo.url).catch((error: unknown) => {
      this.logger.warn(`Photo row ${photoId} was deleted but object cleanup failed: ${String(error)}`);
    });
    return { deleted: true };
  }
}
