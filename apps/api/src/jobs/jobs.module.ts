import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobCursorService } from './job-cursor.service';
import { JOBS_CONFIG, readJobsConfig } from './jobs.config';
import { JobsReaderController, JobsReaderEnabledGuard } from './jobs-reader.controller';
import { JobsReaderService } from './jobs-reader.service';
import { assertZeroHandlerCore } from './job-handler-registry';
import { JobsDatabaseService } from './jobs-database.service';

@Module({imports:[AuthModule],controllers:[JobsReaderController],providers:[JobCursorService,JobsDatabaseService,JobsReaderService,JobsReaderEnabledGuard,{provide:JOBS_CONFIG,useFactory:()=>{assertZeroHandlerCore();return readJobsConfig();}}]})
export class JobsModule {}
