import {
  BadRequestException,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Inject,
  Injectable,
  Param,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import {
  IdentityAccessGuard,
  IdentityRequest,
} from "../auth/identity-access.guard";
import { JOBS_CONFIG, JobsConfig } from "./jobs.config";
import {
  JobDetailDto,
  JobListQueryDto,
  JobListResponseDto,
  JOB_QUERY_KEYS,
} from "./dto/job-reader.dto";
import { JobsReaderService } from "./jobs-reader.service";

@Injectable()
export class JobsReaderEnabledGuard implements CanActivate {
  constructor(@Inject(JOBS_CONFIG) private readonly config: JobsConfig) {}
  canActivate(_context: ExecutionContext): boolean {
    if (!this.config.enabled)
      throw new ServiceUnavailableException({ code: "JOBS_READER_DISABLED" });
    return true;
  }
}

@ApiTags("admin-jobs")
@ApiBearerAuth()
@Controller("admin/v1/jobs")
@UseGuards(JobsReaderEnabledGuard, IdentityAccessGuard)
export class JobsReaderController {
  constructor(private readonly reader: JobsReaderService) {}
  @Get()
  @ApiOperation({ summary: "List masked jobs authorized by literal jobs.read" })
  @ApiOkResponse({ type: JobListResponseDto })
  list(
    @Req() request: IdentityRequest & { query?: Record<string, unknown> },
    @Query() query: JobListQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    if (
      Object.keys(request.query ?? {}).some(
        (key) => !new Set<string>(JOB_QUERY_KEYS).has(key),
      )
    )
      throw new BadRequestException({ code: "INVALID_JOB_QUERY" });
    return this.reader.list(request.user, query);
  }
  @Get(":id")
  @ApiOperation({ summary: "Get one masked authorized job timeline" })
  @ApiOkResponse({ type: JobDetailDto })
  @ApiResponse({
    status: 404,
    description: "Missing and unauthorized jobs are indistinguishable.",
  })
  detail(
    @Req() request: IdentityRequest,
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return this.reader.detail(request.user, id);
  }
}
