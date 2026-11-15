import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { BrandsAdminController } from './brands/brands-admin.controller';
import { BrandsAdminService } from './brands/brands-admin.service';
import { PhotosAdminController } from './tire-models/photos-admin.controller';
import { PhotosAdminService } from './tire-models/photos-admin.service';
import { ProductsAdminController } from './tire-models/products-admin.controller';
import { TireModelsAdminController } from './tire-models/tire-models-admin.controller';
import { TireModelsAdminService } from './tire-models/tire-models-admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Module({
  imports: [AuthModule],
  controllers: [
    AdminController,
    BrandsAdminController,
    TireModelsAdminController,
    ProductsAdminController,
    PhotosAdminController,
  ],
  providers: [BrandsAdminService, TireModelsAdminService, PhotosAdminService, JwtAuthGuard],
})
export class AdminModule {}
