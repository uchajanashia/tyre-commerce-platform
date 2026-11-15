import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

import {
  MAX_IMAGE_WIDTH,
  MAX_UPLOAD_FILE_BYTES,
  safePhotoStorageKey,
  validateImageUpload,
} from './image-upload.policy';

function uploadedFile(
  buffer: Buffer,
  originalname = 'tire.png',
  mimetype = 'image/png',
): Express.Multer.File {
  return {
    fieldname: 'files',
    originalname,
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    destination: '',
    filename: '',
    path: '',
    buffer,
    stream: undefined as never,
  };
}

test('accepts a real, decodable image and returns its canonical storage type', async () => {
  const png = await sharp({
    create: { width: 4, height: 4, channels: 4, background: '#00000000' },
  })
    .png()
    .toBuffer();

  assert.deepEqual(await validateImageUpload(uploadedFile(png)), {
    extension: 'png',
    contentType: 'image/png',
  });
});

test('rejects fake MIME, mismatched extension and malformed image data', async () => {
  const jpeg = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#ffffff' },
  })
    .jpeg()
    .toBuffer();

  await assert.rejects(validateImageUpload(uploadedFile(Buffer.from('not an image'))), /content/);
  await assert.rejects(validateImageUpload(uploadedFile(jpeg, 'tire.png', 'image/png')), /content/);
  await assert.rejects(
    validateImageUpload(uploadedFile(jpeg, 'tire.exe', 'image/jpeg')),
    /extension and MIME/,
  );
  await assert.rejects(
    validateImageUpload(uploadedFile(Buffer.from([0xff, 0xd8, 0xff]), 'tire.jpg', 'image/jpeg')),
    /invalid image/,
  );
});

test('rejects oversized files and excessive dimensions', async () => {
  const oversized = Buffer.alloc(MAX_UPLOAD_FILE_BYTES + 1);
  await assert.rejects(validateImageUpload(uploadedFile(oversized)), /5MB/);

  const tooWide = await sharp({
    create: { width: MAX_IMAGE_WIDTH + 1, height: 1, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer();
  await assert.rejects(validateImageUpload(uploadedFile(tooWide)), /dimensions exceed/);
});

test('storage keys accept normalized internal segments and reject traversal', () => {
  const uuid = '9a1d4e33-a557-4db5-80fd-63bc11d25655';
  assert.equal(
    safePhotoStorageKey('roadx', 'rxquest-c02', 'webp', uuid),
    `roadx/rxquest-c02/${uuid}.webp`,
  );
  assert.throws(() => safePhotoStorageKey('../roadx', 'rxquest-c02', 'webp', uuid), /Unsafe/);
});
