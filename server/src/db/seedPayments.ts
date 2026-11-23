import { PaymentKind } from "@prisma/client";
import { prisma } from "../config/prisma";

/**
 * Redesign R1b seed helper: writes one recorded payment and keeps the project's money totals in
 * step, exactly as modules/payments does (disbursedToDateNgn = net paid; retentionHeldNgn = balance
 * still held; retentionReleasedNgn = released so far). Used where the seed used to create tranche
 * releases. Seeded payments are always MANUAL and carry no exceptions.
 */
export async function seedRecordedPayment(params: {
  projectId: string;
  kind: PaymentKind;
  paidOn: string;
  grossAmountNgn: number;
  retentionHeldNgn?: number;
  reference: string;
  description?: string;
  recordedByName: string;
}) {
  const held = params.kind === "RETENTION_RELEASE" ? 0 : params.retentionHeldNgn ?? 0;
  const net = Math.round((params.grossAmountNgn - held) * 100) / 100;
  await prisma.projectPayment.create({
    data: {
      projectId: params.projectId,
      kind: params.kind,
      paidOn: params.paidOn,
      grossAmountNgn: params.grossAmountNgn,
      retentionHeldNgn: held,
      netAmountNgn: net,
      reference: params.reference,
      description: params.description ?? null,
      source: "MANUAL",
      recordedByName: params.recordedByName,
    },
  });
  await prisma.project.update({
    where: { id: params.projectId },
    data:
      params.kind === "RETENTION_RELEASE"
        ? {
            disbursedToDateNgn: { increment: net },
            retentionHeldNgn: { decrement: params.grossAmountNgn },
            retentionReleasedNgn: { increment: params.grossAmountNgn },
          }
        : { disbursedToDateNgn: { increment: net }, retentionHeldNgn: { increment: held } },
  });
}

/** YYYY-MM-DD n days before today (UTC calendar; fine for seed dates). */
export function seedDaysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString().slice(0, 10);
}
