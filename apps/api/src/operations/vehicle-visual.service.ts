import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuditContext } from "../audit/audit-context";
import { VehicleAssignmentDto } from "./operations.query";

@Injectable()
export class VehicleVisualService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}
  async assign(id: string, dto: VehicleAssignmentDto, context: AuditContext) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.product.findUnique({
        where: { id },
        select: {
          vehicleClassification: true,
          updatedAt: true,
          productType: true,
        },
      });
      if (!before) throw new NotFoundException();
      if (before.productType !== "tire")
        throw new BadRequestException("Vehicle scenes apply to tires only");
      const changed = await tx.product.updateMany({
        where: { id, updatedAt: new Date(dto.expectedUpdatedAt) },
        data: {
          vehicleClassification: dto.classification,
          updatedAt: new Date(
            Math.max(Date.now(), before.updatedAt.getTime() + 1),
          ),
        },
      });
      if (changed.count !== 1)
        throw new ConflictException("Product has changed");
      const after = await tx.product.findUniqueOrThrow({
        where: { id },
        select: { vehicleClassification: true, updatedAt: true },
      });
      await this.audit.recordWithClient(tx, {
        ...context,
        action: "catalog.product.update",
        entityType: "Product",
        entityId: id,
        before,
        after,
      });
      return {
        classification: after.vehicleClassification!,
        updatedAt: after.updatedAt.toISOString(),
      };
    });
  }
}
