import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AdminModule } from './admin/admin.module';
import { OperationsModule } from './operations/operations.module';
import { AuditModule } from './audit/audit.module';
import { AuditReaderModule } from './audit/audit-reader.module';
import { AuthModule } from './auth/auth.module';
import { BrandsModule } from './brands/brands.module';
import { CheckoutModule } from './checkout/checkout.module';
import { FiltersModule } from './filters/filters.module';
import { FitmentModule } from './fitment/fitment.module';
import { HealthModule } from './health/health.module';
import { GovernanceModule } from './governance/governance.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { StorageModule } from './storage/storage.module';
import { JobsModule } from './jobs/jobs.module';
import { ApiProblemBoundaryFilter, OperationContextGuard, ServerCorrelationMiddleware } from './common/api-problem-boundary';

/**
 * Root module. Public read-only catalog (products, brands, filters, health) plus
 * the guarded /admin namespace (JWT auth via AuthModule; see AdminController).
 */
@Module({
  imports: [
    PrismaModule,
    AuditModule,
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 120 }] }),
    StorageModule,
    HealthModule,
    ProductsModule,
    BrandsModule,
    CheckoutModule,
    FiltersModule,
    FitmentModule,
    AuthModule,
    AuditReaderModule,
    JobsModule,
    GovernanceModule,
    AdminModule,
    OperationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: OperationContextGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: ApiProblemBoundaryFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ServerCorrelationMiddleware).forRoutes('*');
  }
}
