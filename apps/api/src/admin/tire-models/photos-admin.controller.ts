import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { ArrayNotEmpty, IsArray, IsString } from "class-validator";

import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { Permissions } from "../../auth/permissions.decorator";
import { RolesGuard } from "../../auth/roles.guard";
import {
  AdminAuditRequest,
  auditContextFromRequest,
} from "../../audit/audit-context";
import {
  IMAGE_UPLOAD_MULTER_OPTIONS,
  MAX_UPLOAD_FILES,
} from "./image-upload.policy";
import { PhotosAdminService } from "./photos-admin.service";

import type { ReorderPhotosRequest } from "@tyre/shared";
import { ApiCreatedResponse, ApiOkResponse } from "@nestjs/swagger";
import {
  AdminPhotoResponseDto,
  DeletedResponseDto,
} from "../../common/dto/route-response.dto";

class ReorderPhotosDto implements ReorderPhotosRequest {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  photoIds!: string[];
}

/** Model photo management: proxy upload to MinIO, reorder, delete. */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Permissions("catalog.media")
export class PhotosAdminController {
  constructor(private readonly photos: PhotosAdminService) {}

  /** multipart/form-data, field "files" (up to 6 per request). */
  @Post("admin/tire-models/:id/photos")
  @ApiCreatedResponse({ type: [AdminPhotoResponseDto] })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FilesInterceptor("files", MAX_UPLOAD_FILES, IMAGE_UPLOAD_MULTER_OPTIONS),
  )
  upload(
    @Param("id") id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: AdminAuditRequest,
  ) {
    return this.photos.upload(id, files, auditContextFromRequest(req));
  }

  @Patch("admin/tire-models/:id/photos/reorder")
  @ApiOkResponse({ type: [AdminPhotoResponseDto] })
  reorder(
    @Param("id") id: string,
    @Body() dto: ReorderPhotosDto,
    @Req() req: AdminAuditRequest,
  ) {
    return this.photos.reorder(id, dto.photoIds, auditContextFromRequest(req));
  }

  @Delete("admin/photos/:photoId")
  @ApiOkResponse({ type: DeletedResponseDto })
  remove(@Param("photoId") photoId: string, @Req() req: AdminAuditRequest) {
    return this.photos.remove(photoId, auditContextFromRequest(req));
  }
}
