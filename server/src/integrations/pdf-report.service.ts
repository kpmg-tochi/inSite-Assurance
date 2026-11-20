import PDFDocument from "pdfkit";
import {
  describeCompletionRule,
  formatDateTimeInZone,
  formatRegistration,
  MilestonePaymentTerms,
  ResolvedTerminology,
  TRANCHE_PAYMENT_BASIS_META,
  resolveTerm,
  TerminologyKey,
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
  /** Null for a direct milestone valuation (Phase 7: no contractor claim). */
  ipcNumber: number | null;
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
    /** Phase 12: registration snapshot; nothing about registration prints when the number is null. */
    certifierLicenseType: string | null;
    certifierLicenseNumber: string | null;
    certifierRegistrationBodyName: string | null;
    certifierRegistrationPrefix: string | null;
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
  /** Phase 10: the active lender decision with its retention split, when one is recorded. */
  releaseDecision?: {
    decision: string;
    approvedNgn: number;
    retentionWithheldNgn: number;
    netReleasedNgn: number;
    retentionPercentage: number | null;
  } | null;
  /** Phase 10: a retention release (no claim, no BOQ lines). */
  retentionRelease?: { stage: string; contractorName: string } | null;
  /** Phase 11: tenant wording for domain terms; omitted uses the defaults (Lender, Tranche, IPC …). */
  terminology?: ResolvedTerminology;
  /** Phase 12: payment basis and completion criteria of a direct milestone verification. */
  paymentTerms?: MilestonePaymentTerms | null;
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
  const terms = data.terminology ?? {};
  const t = (key: TerminologyKey, lower = false) => resolveTerm(terms, key, { lower });
  const direct = data.ipcNumber === null;
  const subject = data.retentionRelease
    ? `${t("retention")} release (${data.retentionRelease.stage === "FINAL" ? "final" : "practical completion"})`
    : direct
      ? "Direct milestone verification"
      : `${t("ipc")} #${data.ipcNumber}`;
  return new Promise((resolve, reject) => {
    const cert = data.certification;
    const doc = new PDFDocument({
      size: "A4",
      margin: 45,
      info: {
        Title: `Disbursement Evidence & Valuation Report — ${data.projectCodePrefix} ${subject}`,
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
          `DRAFT: ${subject} has not been certified (status ${data.ipcStatus}). No certified or recommended amounts exist yet.`,
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
    doc.text(`${t("funderParty")}: ${data.lenderName}`);
    doc.text(`${t("contractor")}: ${data.contractorName}`);
    doc.text(`${t("monitorParty")}: ${data.monitorOrganizationName}`);
    doc.text(`${t("tranche")}: ${data.trancheName} (${subject})`);
    doc.text(`Evidence rating engine: ${engineText(data.ratingEngine, data.ratingEngineDetail)}`);

    doc.moveDown(0.8);

    // Financial Summary
    doc
      .fontSize(11)
      .fillColor("#0f172a")
      .text(`1. ${t("tranche")} Disbursement & Holdback Summary`, { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#1e293b");
    doc.text(
      data.retentionRelease
        ? `• Held retention requested for release to ${data.retentionRelease.contractorName}: ${money(data.totalClaimedNgn)}`
        : direct
          ? `• System Claim from Verified Evidence (no contractor claim): ${money(data.totalClaimedNgn)}`
          : `• ${t("contractor")} Requested Amount (${subject}): ${money(data.totalClaimedNgn)}`,
    );
    if (cert) {
      doc.text(`• ${direct ? "Verified" : "Monitor Certified"} Value (revision ${cert.revisionNumber}): ${money(cert.totalCertifiedNgn)}`);
      doc.text(`• Recommended Release: ${money(cert.recommendedReleaseNgn)}`);
      doc.text(`• Recommended Holdback: ${money(cert.recommendedHoldbackNgn)}`);
      doc.text(`• Formal Recommendation: ${cert.trancheRecommendation}`);
    } else {
      doc.text("• Certified value, recommended release and holdback: not yet certified");
    }
    const rd = data.releaseDecision;
    if (rd) {
      doc.text(`• ${t("funderParty")} Decision: ${rd.decision}, approved ${money(rd.approvedNgn)}`);
      if (rd.retentionWithheldNgn > 0) {
        doc.text(
          `• ${t("retention")} Withheld${rd.retentionPercentage !== null ? ` (${rd.retentionPercentage}%)` : ""}: ${money(rd.retentionWithheldNgn)}`,
        );
      }
      doc.text(`• Paid to ${t("contractor")}: ${money(rd.netReleasedNgn)}`);
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
          (direct ? "No verification summary." : `Reconciliation has not run for this ${t("ipc", true)}.`),
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
          `   Budget: ${money(item.budgetedCostNgn)} | ${direct ? "Evidence supports" : "Claimed"}: ${item.contractorClaimedPct}% | Evidence Rating: ${item.ratingLabel} | ${certified}`,
        );
      doc.moveDown(0.35);
    }

    // Phase 12: payment basis and whether the completion criteria were met.
    const terms = data.paymentTerms;
    if (terms && terms.paymentBasis === "FIXED_ON_COMPLETION") {
      doc.moveDown(0.4);
      doc.fontSize(10).fillColor("#0f172a").text(`Payment basis: ${TRANCHE_PAYMENT_BASIS_META[terms.paymentBasis].label}`);
      doc
        .fontSize(9)
        .fillColor("#334155")
        .text(
          `Fixed amount ${money(terms.fixedReleaseAmountNgn ?? 0)} (already released ${money(terms.alreadyReleasedNgn)}). ` +
            `Completion criteria: ${describeCompletionRule(terms.completionRule, terms.completionRequiredItemPct, terms.targetCompletionPct)}. ` +
            (terms.completionMet ? "Met." : `Not met: ${terms.unmetReasons.join(" ")}`),
        );
    }

    doc.moveDown(1.2);

    // Sign-Off Block
    doc.moveTo(45, doc.y).lineTo(550, doc.y).strokeColor("#94a3b8").stroke();
    doc.moveDown(0.6);
    doc
      .fontSize(10.5)
      .fillColor("#0f172a")
      .text("4. Independent Monitor Certification Sign-Off");
    doc.moveDown(0.3);

    if (cert) {
      // Phase 12: the registration line prints only when the snapshot holds a number.
      const registration = formatRegistration({
        bodyCode: cert.certifierLicenseType,
        prefix: cert.certifierRegistrationPrefix,
        number: cert.certifierLicenseNumber,
      });
      doc
        .fontSize(9)
        .fillColor("#334155")
        .text(
          "I hereby certify that the physical progress and valuation figures stated above have been independently reviewed against geotagged field evidence, hold-point records, and contract Bill of Quantities" +
            (registration ? " in accordance with the professional standards of my registration body." : "."),
        );
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor("#0f172a").text(`Certified By: ${cert.certifierFullName}`);
      if (registration) {
        doc.text(
          `Professional registration: ${registration}${cert.certifierRegistrationBodyName ? ` (${cert.certifierRegistrationBodyName})` : ""}`,
        );
      }
      doc.text(`Timestamp: ${formatDateTimeInZone(cert.certifiedAtIso, data.timeZone ?? "UTC")}`);
    } else {
      doc.fontSize(9).fillColor("#334155").text(`Not signed: this ${t("ipc", true)} has not been certified.`);
    }

    doc.end();
  });
}
