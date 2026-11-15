import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as Minio from 'minio';

/**
 * MinIO wrapper for product photos.
 *
 * Design decisions (Phase 6, Stage A):
 *  - WRITES go through the API only (server-side proxy upload from the
 *    authenticated adminka). No presigned PUTs — MinIO stays private for writes.
 *  - READS are public: the bucket gets an anonymous-read policy and photos are
 *    served as stable direct URLs (PHOTO_BASE_URL + object key). Presigned GETs
 *    were rejected because their expiring query strings defeat the planned
 *    Cloudflare CDN caching (docs/DECISIONS.md hosting target).
 *  - The DB stores only the object KEY; the base URL is config, so moving to a
 *    CDN domain later is an env change, not a data migration.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client!: Minio.Client;
  readonly bucket = process.env.MINIO_BUCKET ?? 'tyre-photos';

  /** Prefix for building public photo URLs from stored object keys. */
  readonly publicBaseUrl = (process.env.PHOTO_BASE_URL ?? `http://localhost:9000/${process.env.MINIO_BUCKET ?? 'tyre-photos'}`).replace(/\/+$/, '');

  async onModuleInit(): Promise<void> {
    this.client = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      port: Number(process.env.MINIO_PORT ?? 9000),
      useSSL: (process.env.MINIO_USE_SSL ?? 'false') === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'tyre',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'tyre-minio-dev',
    });

    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`Created bucket "${this.bucket}"`);
      }
      // Anonymous read-only for the whole bucket — photos are public content.
      await this.client.setBucketPolicy(
        this.bucket,
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.bucket}/*`],
            },
          ],
        }),
      );
      this.logger.log(`Bucket "${this.bucket}" ready (public read)`);
    } catch (err) {
      // Photos are non-critical: the API must still serve the catalog if MinIO
      // is down. Upload endpoints will surface errors when actually used.
      this.logger.error(`MinIO unavailable: ${(err as Error).message} — photo uploads will fail until it is up`);
    }
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  /** Used by dependency-aware readiness; throws when object storage is unavailable. */
  async assertReady(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      throw new Error(`Bucket "${this.bucket}" does not exist.`);
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(this.bucket, key, body, body.length, {
      'Content-Type': contentType,
      // Immutable content-addressed-ish keys → long cache is safe.
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  }

  async remove(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }
}
