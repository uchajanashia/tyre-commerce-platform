import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuditCursorService } from './audit-cursor.service';
import { AuditDatabaseService } from './audit-database.service';
import { AuditReaderController, AuditReaderEnabledGuard } from './audit-reader.controller';
import { AUDIT_READER_CONFIG, readAuditReaderConfig } from './audit-reader.config';
import { AuditReaderService } from './audit-reader.service';

@Module({
  imports: [AuthModule],
  controllers: [AuditReaderController],
  providers: [
    AuditCursorService,
    AuditDatabaseService,
    AuditReaderService,
    AuditReaderEnabledGuard,
    { provide: AUDIT_READER_CONFIG, useFactory: readAuditReaderConfig },
  ],
})
export class AuditReaderModule {}
