import PDFDocument from "pdfkit";
import {
  PROFESSIONAL_LICENSE_META,
  ProfessionalLicenseType,
} from "@insite/shared";

export interface ValuationReportPdfInput {
  projectName: string;
  projectCodePrefix: string;
  stateLocation: string;
  lenderName: string;
  contractorName: string;
  monitorOrganizationName: string;
  ipcNumber: number;
  trancheName: string;
  totalClaimedNgn: number;
  recommendedReleaseNgn: number;
  recommendedHoldbackNgn: number;
  trancheRecommendation: string;
  executiveSummary: string;
  certifierFullName: string;
  certifierLicenseType: ProfessionalLicenseType;
  certifierLicenseNumber: string;
  certifiedAtIso: string;
  lineItems: Array<{
    wbsCode: string;
    description: string;
    budgetedCostNgn: number;
    contractorClaimedPct: number;
    aiEvidenceRating: string;
    monitorCertifiedPct: number;
    monitorCertifiedNgn: number;
  }>;
}

export async function generateValuationReportPdfBuffer(
  data: ValuationReportPdfInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 45,
      info: {
        Title: `Disbursement Evidence & Valuation Report — ${data.projectCodePrefix} IPC #${data.ipcNumber}`,
        Author: data.certifierFullName,
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const licenseMeta =
      PROFESSIONAL_LICENSE_META[data.certifierLicenseType] ??
      PROFESSIONAL_LICENSE_META.QSRBN;

    // Header Banner
    doc
      .fontSize(16)
      .fillColor("#0f172a")
      .text("InSite Assurance — Disbursement Evidence & Valuation Report", {
        align: "left",
      });
    doc
      .moveDown(0.3)
      .fontSize(9)
      .fillColor("#475569")
      .text(
        `Independent Project Monitoring Certification | Generated: ${new Date(
          data.certifiedAtIso,
        ).toUTCString()}`,
      );

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
    doc.text(`Main Contractor: ${data.contractorName}`);
    doc.text(
      `Independent Monitoring Practice: ${data.monitorOrganizationName}`,
    );
    doc.text(`Facility Tranche: ${data.trancheName} (IPC #${data.ipcNumber})`);

    doc.moveDown(0.8);

    // Financial Reconciliation Summary Box
    doc
      .fontSize(11)
      .fillColor("#0f172a")
      .text("1. Tranche Disbursement & Holdback Summary", { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#1e293b");
    doc.text(
      `• Contractor Requested Amount (IPC #${data.ipcNumber}): NGN ${data.totalClaimedNgn.toLocaleString()}`,
    );
    doc.text(
      `• Monitor Certified & Recommended Release: NGN ${data.recommendedReleaseNgn.toLocaleString()}`,
    );
    doc.text(
      `• Recommended Risk Holdback Amount: NGN ${data.recommendedHoldbackNgn.toLocaleString()}`,
    );
    doc.text(`• Formal Recommendation: ${data.trancheRecommendation}`);

    doc.moveDown(0.8);

    // Executive Summary
    doc
      .fontSize(11)
      .fillColor("#0f172a")
      .text("2. Executive Certification & Field Evidence Summary", {
        underline: true,
      });
    doc.moveDown(0.4);
    doc.fontSize(9.5).fillColor("#334155").text(data.executiveSummary, {
      align: "justify",
    });

    doc.moveDown(0.8);

    // Line-Item Table
    doc
      .fontSize(11)
      .fillColor("#0f172a")
      .text("3. Line-by-Line BOQ Claim vs. Field Evidence Schedule", {
        underline: true,
      });
    doc.moveDown(0.4);

    for (const item of data.lineItems) {
      doc
        .fontSize(9.5)
        .fillColor("#0f172a")
        .text(`[${item.wbsCode}] ${item.description}`);
      doc
        .fontSize(8.5)
        .fillColor("#475569")
        .text(
          `   Budget: NGN ${item.budgetedCostNgn.toLocaleString()} | Claimed: ${item.contractorClaimedPct}% | AI Evidence Rating: ${item.aiEvidenceRating} | Monitor Certified: ${item.monitorCertifiedPct}% (NGN ${item.monitorCertifiedNgn.toLocaleString()})`,
        );
      doc.moveDown(0.35);
    }

    doc.moveDown(1.2);

    // Regulatory Sign-Off Block (QSRBN / COREN)
    doc.moveTo(45, doc.y).lineTo(550, doc.y).strokeColor("#94a3b8").stroke();
    doc.moveDown(0.6);

    doc
      .fontSize(10.5)
      .fillColor("#0f172a")
      .text("4. Licensed Independent Monitor Certification Sign-Off");
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .fillColor("#334155")
      .text(
        "I hereby certify that the physical progress and valuation figures stated above have been independently reviewed against geotagged field evidence, hold-point records, and contract Bill of Quantities in accordance with Nigerian professional regulatory standards.",
      );
    doc.moveDown(0.5);
    doc
      .fontSize(10)
      .fillColor("#0f172a")
      .text(`Certified By: ${data.certifierFullName}`);
    doc.text(
      `Regulatory Credential: ${licenseMeta.displayPrefix} ${data.certifierLicenseNumber} (${licenseMeta.fullName})`,
    );
    doc.text(`Timestamp: ${data.certifiedAtIso}`);

    doc.end();
  });
}
