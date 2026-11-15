import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

export const workflowsEnabled = () =>
  process.env.OPERATIONS_WORKFLOWS_ENABLED === "true";
export function requireWorkflows() {
  if (!workflowsEnabled())
    throw new ServiceUnavailableException(
      "Operations workflows are not enabled",
    );
}
export function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function retryableWorkflowConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (["P2034", "P2002"].includes(error.code) ||
      (error.code === "P2010" &&
        ["40001", "40P01"].includes(String(error.meta?.["code"]))))
  );
}
export async function workflowTransaction<T>(
  db: PrismaService,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: "Serializable",
        timeout: 15000,
      });
    } catch (error) {
      if (retryableWorkflowConflict(error) && attempt < 3) continue;
      throw error;
    }
  }
}
export async function replay(
  tx: Prisma.TransactionClient,
  id: string,
  hash: string,
) {
  const command = await tx.operationsCommand.findUnique({ where: { id } });
  if (command && command.fingerprint !== hash)
    throw new ConflictException("Request identifier already used");
  return command?.result;
}
export function minorAmount(value: string | number | undefined): number | null {
  if (value === undefined || !/^\d+(\.\d{1,2})?$/.test(String(value)))
    return null;
  const [whole, fraction = ""] = String(value).split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) ? amount : null;
}
