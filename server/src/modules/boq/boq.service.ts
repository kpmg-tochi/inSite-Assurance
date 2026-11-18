import { Readable } from 'stream';
import ExcelJS from 'exceljs';
import {
  BoqItemInput,
  BoqItemInputSchema,
  UpdateBoqMappingsRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { azureOpenAiService } from '../../integrations/azure-openai.service';
import { recordAuditEvent } from '../audit/audit.service';
import { loadBoqItemInProject, loadTrancheInProject } from '../../utils/ownership';
import { serializeBoqItem } from '../../utils/serializers';

const MAX_BOQ_FILE_BYTES = 10 * 1024 * 1024;

/** Plain value of an ExcelJS cell (formula results, rich text and hyperlinks unwrapped). */
function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('result' in value) return cellValue(value.result as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value) return value.text;
    return '';
  }
  return value;
}

/** Reads the first worksheet of an .xlsx or .csv buffer into header-keyed row objects. */
async function readSpreadsheetRows(buffer: Buffer): Promise<Record<string, unknown>[]> {
  const workbook = new ExcelJS.Workbook();
  const isZip = buffer.length > 2 && buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK": .xlsx
  try {
    if (isZip) {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } else {
      await workbook.csv.read(Readable.from(buffer));
    }
  } catch {
    throw new AppError(
      'Could not read the BOQ file. Upload an .xlsx or .csv file.',
      400,
      'INVALID_BOQ_FILE'
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) {
    throw new AppError('Uploaded BOQ file contains no rows', 400, 'EMPTY_BOQ_FILE');
  }

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(cellValue(cell.value)).trim();
  });

  const rows: Record<string, unknown>[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const record: Record<string, unknown> = {};
    let hasValue = false;
    headers.forEach((header, col) => {
      if (!header) return;
      const v = cellValue(row.getCell(col).value);
      if (v !== '') hasValue = true;
      record[header] = v;
    });
    if (hasValue) rows.push(record);
  }
  return rows;
}

/**
 * Parses a base64-encoded .xlsx or .csv spreadsheet into BoqItemInput rows.
 */
export async function parseBoqSpreadsheetBase64(base64Content: string): Promise<BoqItemInput[]> {
  const buffer = Buffer.from(base64Content, 'base64');
  if (buffer.length > MAX_BOQ_FILE_BYTES) {
    throw new AppError('BOQ file is larger than 10 MB', 413, 'FILE_TOO_LARGE');
  }
  const rawRows = await readSpreadsheetRows(buffer);

  const items: BoqItemInput[] = [];
  for (let idx = 0; idx < rawRows.length; idx++) {
    const row = rawRows[idx];
    const wbsCode = String(
      row['WBS'] || row['wbsCode'] || row['Item No'] || row['Code'] || `01.${idx + 1}`
    ).trim();
    const section = String(
      row['Section'] || row['section'] || row['Bill'] || 'GENERAL CIVIL WORKS'
    ).trim();
    const description = String(
      row['Description'] || row['description'] || row['Work Item'] || ''
    ).trim();
    if (!description || description.length < 3) {
      continue;
    }

    const unit = String(row['Unit'] || row['unit'] || 'item').trim();
    const totalQuantity = Number(row['Quantity'] || row['totalQuantity'] || 1);
    const rateNgn = Number(row['Rate'] || row['rateNgn'] || 0);
    const budgetedCostNgn =
      Number(row['Amount'] || row['budgetedCostNgn'] || 0) ||
      totalQuantity * rateNgn;

    const parsed = BoqItemInputSchema.parse({
      wbsCode,
      section,
      description,
      unit,
      totalQuantity: totalQuantity > 0 ? totalQuantity : 1,
      rateNgn: rateNgn >= 0 ? rateNgn : 0,
      budgetedCostNgn: budgetedCostNgn >= 0 ? budgetedCostNgn : 0,
      isHoldPoint: Boolean(row['HoldPoint'] || row['isHoldPoint'] || false),
    });

    items.push(parsed);
  }

  return items;
}

export async function listProjectBoqItems(projectId: string) {
  const items = await prisma.boqItem.findMany({
    where: { projectId },
    orderBy: { wbsCode: 'asc' },
    include: {
      tranche: {
        select: { id: true, trancheNumber: true, name: true },
      },
    },
  });

  return items.map((item) => serializeBoqItem(item));
}

export async function uploadAndAnalyzeProjectBoq(params: {
  projectId: string;
  webUser: WebJwtPayload;
  items?: BoqItemInput[];
  spreadsheetBase64?: string;
}) {
  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    include: {
      tranches: {
        orderBy: { trancheNumber: 'asc' },
      },
    },
  });

  if (!project) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }

  const parsedItems =
    params.items && params.items.length > 0
      ? params.items.map((i) => BoqItemInputSchema.parse(i))
      : params.spreadsheetBase64
      ? await parseBoqSpreadsheetBase64(params.spreadsheetBase64)
      : [];

  if (parsedItems.length === 0) {
    throw new AppError(
      'Provide either a non-empty items array or spreadsheetBase64 payload',
      400,
      'EMPTY_BOQ_PAYLOAD'
    );
  }

  // Run Azure OpenAI (or deterministic QSRBN heuristic) BOQ Hygiene & Tranche Mapping
  const aiAnalysis = await azureOpenAiService.analyzeBoqItems({
    totalProjectBudgetNgn: Number(project.totalBudgetNgn),
    tranches: project.tranches.map((t) => ({
      trancheNumber: t.trancheNumber,
      name: t.name,
    })),
    boqItems: parsedItems,
  });

  const analysisByWbs = new Map(
    aiAnalysis.items.map((a) => [a.wbsCode, a])
  );
  const trancheIdByNumber = new Map(
    project.tranches.map((t) => [t.trancheNumber, t.id])
  );

  return prisma.$transaction(async (tx) => {
    const upsertedItems = [];

    for (const item of parsedItems) {
      const analysis = analysisByWbs.get(item.wbsCode);
      const suggestedTrancheId =
        item.trancheId ??
        (analysis?.suggestedTrancheNumber
          ? trancheIdByNumber.get(analysis.suggestedTrancheNumber) ?? null
          : null);

      const record = await tx.boqItem.upsert({
        where: {
          projectId_wbsCode: {
            projectId: params.projectId,
            wbsCode: item.wbsCode,
          },
        },
        create: {
          projectId: params.projectId,
          wbsCode: item.wbsCode,
          section: item.section,
          description: item.description,
          unit: item.unit,
          totalQuantity: item.totalQuantity,
          rateNgn: item.rateNgn,
          budgetedCostNgn: item.budgetedCostNgn,
          isHoldPoint: item.isHoldPoint || Boolean(analysis?.recommendedIsHoldPoint),
          holdPointInstruction:
            item.holdPointInstruction ??
            analysis?.recommendedHoldPointInstruction ??
            null,
          isOpaqueLumpSum: Boolean(analysis?.isOpaqueLumpSum),
          opacityWarningReason: analysis?.opacityWarningReason ?? null,
          trancheId: suggestedTrancheId,
          aiSuggestedTrancheId: suggestedTrancheId,
          trancheMappingConfirmedByMonitor: Boolean(item.trancheId),
        },
        update: {
          section: item.section,
          description: item.description,
          unit: item.unit,
          totalQuantity: item.totalQuantity,
          rateNgn: item.rateNgn,
          budgetedCostNgn: item.budgetedCostNgn,
          isHoldPoint: item.isHoldPoint || Boolean(analysis?.recommendedIsHoldPoint),
          holdPointInstruction:
            item.holdPointInstruction ??
            analysis?.recommendedHoldPointInstruction ??
            null,
          isOpaqueLumpSum: Boolean(analysis?.isOpaqueLumpSum),
          opacityWarningReason: analysis?.opacityWarningReason ?? null,
          aiSuggestedTrancheId: suggestedTrancheId,
        },
      });

      upsertedItems.push(record);
    }

    const opaqueCount = upsertedItems.filter((i) => i.isOpaqueLumpSum).length;
    const holdPointCount = upsertedItems.filter((i) => i.isHoldPoint).length;

    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: `${params.webUser.fullName} (${params.webUser.roleName})`,
      action: 'BOQ_UPLOADED',
      summaryText: `Uploaded and analyzed ${upsertedItems.length} BOQ line items (${holdPointCount} Hold Points, ${opaqueCount} Opaque Lump Sums flagged).`,
      payload: {
        itemCount: upsertedItems.length,
        opaqueCount,
        holdPointCount,
      },
    });

    return {
      totalUploaded: upsertedItems.length,
      opaqueLumpSumCount: opaqueCount,
      holdPointCount,
      items: upsertedItems.map((item) => serializeBoqItem(item)),
    };
  });
}

export async function confirmBoqTrancheMappings(params: {
  projectId: string;
  webUser: WebJwtPayload;
  input: UpdateBoqMappingsRequest;
}) {
  return prisma.$transaction(async (tx) => {
    const updated = [];
    for (const u of params.input.updates) {
      await loadBoqItemInProject(tx, params.projectId, u.boqItemId);
      if (u.trancheId) {
        await loadTrancheInProject(tx, params.projectId, u.trancheId);
      }
      const item = await tx.boqItem.update({
        where: { id: u.boqItemId, projectId: params.projectId },
        data: {
          trancheId: u.trancheId,
          trancheMappingConfirmedByMonitor: true,
          isHoldPoint: u.isHoldPoint,
          ...(u.holdPointInstruction !== undefined
            ? { holdPointInstruction: u.holdPointInstruction }
            : {}),
        },
      });
      updated.push(item);
    }

    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: `${params.webUser.fullName} (${params.webUser.roleName})`,
      action: 'BASELINE_UPDATED',
      summaryText: `Monitor confirmed BOQ-to-Tranche mappings and Hold Point settings for ${updated.length} line item(s).`,
      payload: { updatedBoqItemIds: updated.map((i) => i.id) },
    });

    return updated.map((item) => serializeBoqItem(item));
  });
}

