import PDFDocument from "pdfkit";
import {
  formatDateTimeInZone,
  PROFESSIONAL_LICENSE_META,
  ProfessionalLicenseType,
} from "@insite/shared";

export interface ValuationReportPdfInput {
  tenantName?: string;
  pdfHeaderTitle?: string;
  pdfFooterDisclaimer?: string;
  primaryColorHex?: string;
  projectName: string;
  projectCodePrefix: string;
  stateLocation: string;
  lenderName: string;
  contractorName: string;
  monitorOrganizationName: string;
  /** Tenant currency (ISO 4217); amounts print with the code because the PDF font has no ₦ glyph. */
  currency?: string;
  /** Project IANA zone for printed times. */
  timeZone?: string;
  ipcNumber: number;
  ipcStatus: string;
  trancheName: string;
  totalClaimedNgn: number;
  /** AZURE_OPENAI, RULES_ENGINE, or null if reconciliation has not run. */
  ratingEngine: string | null;
  ratingEngineDetail: string | null;
  aiExecutiveSummary: string | null;
  /** Null until the IPC has been certified; the PDF then says so instead of printing placeholders. */
  certification: {
    revisionNumber: number;
    totalCertifiedNgn: number;
    recommendedReleaseNgn: number;
    recommendedHoldbackNgn: number;
    trancheRecommendation: string;
    executiveSummary: string;
    certifierFullName: string;
    certifierLicenseType: ProfessionalLicenseType;
    certifierLicenseNumber: string;
    certifiedAtIso: string;
  } | null;
  lineItems: Array<{
    wbsCode: string;
    description: string;
    budgetedCostNgn: number;
    contractorClaimedPct: number;
    /** Tenant display label for the canonical rating. */
    ratingLabel: string;
    monitorCertifiedPct: number | null;
    monitorCertifiedNgn: number | null;
  }>;
}

const moneyFormatter = (currency: string) => (n: number) =>
  `${currency} ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function engineText(engine: string | null, detail: string | null): string {
  if (engine === "AZURE_OPENAI") return `Azure OpenAI (${detail ?? "deployment not recorded"})`;
  if (engine === "RULES_ENGINE") return `Rules engine${detail ? ` (${detail})` : ""}`;
  return "Not recorded";
}

export async function generateValuationReportPdfBuffer(
  data: ValuationReportPdfInput,
): Promise<Buffer> {
  const money = moneyFormatter(data.currency ?? "NGN");
  return new Promise((resolve, reject) => {
    const cert = data.certification;
    const doc = new PDFDocument({
      size: "A4",
      margin: 45,
      info: {
        Title: `Disbursement Evidence & Valuation Report — ${data.projectCodePrefix} IPC #${data.ipcNumber}`,
        Author: cert?.certifierFullName ?? data.tenantName ?? "InSite Assurance",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header Banner (Tenant-Branded)
    doc
      .fontSize(16)
      .fillColor(data.primaryColorHex || "#0f172a")
      .text(
        data.pdfHeaderTitle ||
          "InSite Assurance — Disbursement Evidence & Valuation Report",
        { align: "left" },
      );
    doc
      .moveDown(0.3)
      .fontSize(9)
      .fillColor("#475569")
      .text(
        `${
          data.pdfFooterDisclaimer ||
          data.tenantName ||
          "Independent Project Monitoring Certification"
        } | Generated: ${formatDateTimeInZone(new Date(), data.timeZone ?? "UTC")}`,
      );

    if (!cert) {
      doc
        .moveDown(0.4)
        .fontSize(10)
        .fillColor("#b91c1c")
        .text(
          `DRAFT: IPC #${data.ipcNumber} has not been certified (status ${data.ipcStatus}). No certified or recommended amounts exist yet.`,
        );
    }

    doc.moveDown(0.8);
    doc.moveTo(45, doc.y).lineTo(550, doc.y).strokeColor("#cbd5e1").stroke();
    doc.moveDown(0.8);

    // Project & Facility Metadata
    doc
      .fontSize(11)
      .fillColor("#0f172a")
      .text(`Project: [${data.projectCodePrefix}] ${data.projectName}`);
    doc.fontSize(10).fillColor("#334155");
    doc.text(`Location: ${data.stateLocation}`);
    doc.text(`Lender / Guarantor: ${data.lenderName}`);
    doc.text(`Contractor: ${data.contractorName}`);
    doc.text(`Independent Monitoring Practice: ${data.monitorOrganizationName}`);
    doc.text(`Facility Tranche: ${data.trancheName} (IPC #${data.ipcNumber})`);
    doc.text(`Evidence rating engine: ${engineText(data.ratingEngine, data.ratingEngineDetail)}`);

    doc.moveDown(0.8);

    // Financial Summary
    doc
      .fontSize(11)
      .fillColor("#0f172a")
      .text("1. Tranche Disbursement & Holdback Summary", { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#1e293b");
    doc.text(`• Contractor Requested Amount (IPC #${data.ipcNumber}): ${money(data.totalClaimedNgn)}`);
    if (cert) {
      doc.text(`• Monitor Certified Value (revision ${cert.revisionNumber}): ${money(cert.totalCertifiedNgn)}`);
      doc.text(`• Recommended Release: ${money(cert.recommendedReleaseNgn)}`);
      doc.text(`• Recommended Holdback: ${money(cert.recommendedHoldbackNgn)}`);
      doc.text(`• Formal Recommendation: ${cert.trancheRecommendation}`);
    } else {
      doc.text("• Certified value, recommended release and holdback: not yet certified");
    }

    doc.moveDown(0.8);

    // Executive Summary
    doc
      .fontSize(11)
      .fillColor("#0f172a")
      .text(
        cert
          ? "2. Executive Certification Summary"
          : "2. Reconciliation Summary (not a certification)",
        { underline: true },
      );
    doc.moveDown(0.4);
    doc
      .fontSize(9.5)
      .fillColor("#334155")
      .text(
        cert?.executiveSummary ??
          data.aiExecutiveSummary ??
          "Reconciliation has not run for this IPC.",
        { align: "justify" },
      );

    doc.moveDown(0.8);

    // Line-Item Table
    doc
      .fontSize(11)
      .fillColor("#0f172a")
      .text("3. Line-by-Line BOQ Claim vs. Field Evidence Schedule", { underline: true });
    doc.moveDown(0.4);

    for (const item of data.lineItems) {
      const certified =
        item.monitorCertifiedPct === null
          ? "Monitor Certified: pending"
          : `Monitor Certified: ${item.monitorCertifiedPct}% (${money(item.monitorCertifiedNgn ?? 0)})`;
      doc
        .fontSize(9.5)
        .fillColor("#0f172a")
        .text(`[${item.wbsCode}] ${item.description}`);
      doc
        .fontSize(8.5)
        .fillColor("#475569")
        .text(
          `   Budget: ${money(item.budgetedCostNgn)} | Claimed: ${item.contractorClaimedPct}% | Evidence Rating: ${item.ratingLabel} | ${certified}`,
        );
      doc.moveDown(0.35);
    }

    doc.moveDown(1.2);

    // Sign-Off Block
    doc.moveTo(45, doc.y).lineTo(550, doc.y).strokeColor("#94a3b8").stroke();
    doc.moveDown(0.6);
    doc
      .fontSize(10.5)
      .fillColor("#0f172a")
      .text("4. Licensed Independent Monitor Certification Sign-Off");
    doc.moveDown(0.3);

    if (cert) {
      const licenseMeta =
        PROFESSIONAL_LICENSE_META[cert.certifierLicenseType] ?? PROFESSIONAL_LICENSE_META.QSRBN;
      doc
        .fontSize(9)
        .fillColor("#334155")
        .text(
          "I hereby certify that the physical progress and valuation figures stated above have been independently reviewed against geotagged field evidence, hold-point records, and contract Bill of Quantities in accordance with Nigerian professional regulatory standards.",
        );
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor("#0f172a").text(`Certified By: ${cert.certifierFullName}`);
      doc.text(
        `Regulatory Credential: ${licenseMeta.displayPrefix} ${cert.certifierLicenseNumber} (${licenseMeta.fullName})`,
      );
      doc.text(`Timestamp: ${formatDateTimeInZone(cert.certifiedAtIso, data.timeZone ?? "UTC")}`);
    } else {
      doc.fontSize(9).fillColor("#334155").text("Not signed: this IPC has not been certified.");
    }

    doc.end();
  });
}
