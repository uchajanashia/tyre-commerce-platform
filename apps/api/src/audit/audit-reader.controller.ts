import {
  BadRequestException, CanActivate, Controller, ExecutionContext, Get, Inject, Injectable, Param, Query, Req, Res,
  ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { IdentityAccessGuard, IdentityRequest } from '../auth/identity-access.guard';
import { AUDIT_READER_CONFIG, AuditReaderConfig } from './audit-reader.config';
import { AuditReaderService } from './audit-reader.service';
import {
  AUDIT_QUERY_KEYS, AuditEventDetailDto, AuditEventListQueryDto, AuditEventListResponseDto,
} from './dto/audit-reader.dto';

@Injectable()
export class AuditReaderEnabledGuard implements CanActivate {
  constructor(@Inject(AUDIT_READER_CONFIG) private readonly config: AuditReaderConfig) {}
  canActivate(_context: ExecutionContext): boolean {
    if (!this.config.enabled) throw new ServiceUnavailableException({ code: 'AUDIT_READER_DISABLED' });
    return true;
  }
}

@ApiTags('admin-audit')
@ApiBearerAuth()
@Controller('admin/v1/audit-events')
@UseGuards(AuditReaderEnabledGuard, IdentityAccessGuard)
export class AuditReaderController {
  constructor(private readonly reader: AuditReaderService) {}

  @Get()
  @ApiOperation({ summary: 'List masked, event-time-authorized V2 audit events' })
  @ApiOkResponse({ type: AuditEventListResponseDto })
  list(
    @Req() request: IdentityRequest & { query?: Record<string, unknown> },
    @Query() query: AuditEventListQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    this.assertClosedQuery(request.query ?? {});
    return this.reader.list(request.user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one masked, event-time-authorized V2 audit event' })
  @ApiOkResponse({ type: AuditEventDetailDto })
  @ApiResponse({ status: 404, description: 'Missing, unauthorized, wrong-scope and legacy rows are indistinguishable.' })
  detail(
    @Req() request: IdentityRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.reader.detail(request.user, id);
  }

  private assertClosedQuery(raw: Record<string, unknown>): void {
    const allowed = new Set<string>(AUDIT_QUERY_KEYS);
    if (Object.keys(raw).some((key) => !allowed.has(key))) {
      throw new BadRequestException({ code: 'INVALID_AUDIT_QUERY' });
    }
  }
}
