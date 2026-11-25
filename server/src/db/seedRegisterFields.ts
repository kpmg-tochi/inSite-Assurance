import { prisma } from "../config/prisma";
import { PROGRAMME_TENANT_SLUG } from "./seedPhase11";

/**
 * UBEC IRL register fields on the seeded programme projects (runs after seedClosureTwin): an
 * intervention year, the funding source of the project type (Direct Intervention: "UBEC
 * Intervention Fund"; Matching Grants: "Matching grant (SUBEB counterpart)") and a UBEC-style
 * project ID (UBEC/<DI|MG>/<year>/<state>/<number>). One pass over every PRG-* project, drafts
 * included, so the projects created earlier in the seed need no edits.
 *
 * | Project | Year | Project ID            |
 * | ------- | ---- | --------------------- |
 * | PRG-101 | 2026 | UBEC/DI/2026/KN/101   |
 * | PRG-102 | 2025 | UBEC/DI/2025/KN/102   |
 * | PRG-103 | 2024 | UBEC/DI/2024/KN/103   |
 * | PRG-104 | 2025 | UBEC/DI/2025/LA/104   |
 * | PRG-105 | 2025 | UBEC/DI/2025/KN/105   |
 * | PRG-106 | 2024 | UBEC/DI/2024/KN/106   |
 * | PRG-2xx | 2023–2026 | UBEC/MG/<year>/<state>/2xx |
 */

const YEAR_BY_CODE: Record<string, number> = {
  "PRG-101": 2026,
  "PRG-102": 2025,
  "PRG-103": 2024,
  "PRG-104": 2025,
  "PRG-105": 2025,
  "PRG-106": 2024,
  "PRG-201": 2026,
  "PRG-211": 2025,
  "PRG-221": 2025,
  "PRG-241": 2023,
  "PRG-242": 2023,
};

const STATE_CODE: Record<string, string> = { Kano: "KN", Kaduna: "KD", Lagos: "LA", Ogun: "OG" };

export const SEED_FUNDING_BY_TYPE_CODE: Record<string, string> = {
  CENTRAL: "UBEC Intervention Fund",
  CO_FUNDED: "Matching grant (SUBEB counterpart)",
};

export async function seedRegisterFields(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { slug: PROGRAMME_TENANT_SLUG }, select: { id: true } });
  if (!tenant) return;
  const projects = await prisma.project.findMany({
    where: { tenantId: tenant.id, codePrefix: { startsWith: "PRG-" } },
    select: { id: true, codePrefix: true, stateLocation: true, region: { select: { name: true } }, projectType: { select: { code: true } } },
  });
  for (const p of projects) {
    const typeCode = p.projectType?.code ?? "CENTRAL";
    const year = YEAR_BY_CODE[p.codePrefix] ?? 2025;
    const state = STATE_CODE[p.region?.name ?? ""] ?? STATE_CODE[p.stateLocation ?? ""] ?? "FC";
    await prisma.project.update({
      where: { id: p.id },
      data: {
        interventionYear: year,
        fundingSource: SEED_FUNDING_BY_TYPE_CODE[typeCode] ?? SEED_FUNDING_BY_TYPE_CODE.CENTRAL,
        externalReference: `UBEC/${typeCode === "CO_FUNDED" ? "MG" : "DI"}/${year}/${state}/${p.codePrefix.slice(4)}`,
      },
    });
  }
}
