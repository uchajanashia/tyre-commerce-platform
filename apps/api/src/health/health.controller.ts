import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";

import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import {
  LiveHealthResponseDto,
  ReadyHealthResponseDto,
} from "../common/dto/route-response.dto";

interface HealthResult {
  status: "ok";
  checks: { database: "ok"; storage: "ok" };
}

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Backward-compatible operator endpoint: readiness, not a false-green PID check. */
  @Get()
  @ApiOkResponse({ type: ReadyHealthResponseDto })
  check(): Promise<HealthResult> {
    return this.ready();
  }

  @Get("live")
  @ApiOkResponse({ type: LiveHealthResponseDto })
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  @ApiOkResponse({ type: ReadyHealthResponseDto })
  async ready(): Promise<HealthResult> {
    const [database, storage] = await Promise.allSettled([
      (process.env.APP_ENV ?? process.env.NODE_ENV) === "production"
        ? this.prisma.assertRuntimeBoundary()
        : this.prisma.$queryRaw`SELECT 1`,
      this.storage.assertReady(),
    ]);

    if (database.status === "rejected" || storage.status === "rejected") {
      throw new ServiceUnavailableException({
        status: "error",
        checks: {
          database: database.status === "fulfilled" ? "ok" : "error",
          storage: storage.status === "fulfilled" ? "ok" : "error",
        },
      });
    }

    return { status: "ok", checks: { database: "ok", storage: "ok" } };
  }
}
