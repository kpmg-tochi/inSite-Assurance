import PDFDocument from "pdfkit";

/**
 * Demo data: short, clean specimen PDFs for every document type the seed and the demo use
 * (`DEFAULT_DOCUMENT_TYPES` plus the beneficiary's signed paper copy of a Certificate of Completion).
 * A UBEC letterhead, a title, a few lines of plausible content filled from the project when given
 * (generic wording otherwise), signature lines and a "SPECIMEN – demo data" footer. Text only: no
 * logos, no real people beyond the seeded demo personas. Used by the seed (`fileDocument`) and by
 * the demo pack (`server/src/scripts/buildDemoPack.ts`).
 */

export interface DemoDocumentContext {
  projectName?: string | null;
  projectCode?: string | null;
  school?: string | null;
  contractor?: string | null;
  contractReference?: string | null;
  contractSumNgn?: number | null;
  state?: string | null;
  lga?: string | null;
  /** The document's date (YYYY-MM-DD). */
  date?: string | null;
  awardDate?: string | null;
  signedDate?: string | null;
  kickoffDate?: string | null;
  /** Days from the kick-off to mobilise (Direct Intervention: 21). */
  mobilisationDays?: number | null;
  /** The officers named in the supervisor assignment and the letter of introduction. */
  residentSupervisor?: string | null;
  meOfficer?: string | null;
  /** Scope summary lines (one per facility unit). */
  scope?: string[] | null;
  sprints?: Array<{ name: string; startDate: string; endDate: string; deliverables?: string | null }> | null;
  /** Signed paper copy of the Certificate of Completion: who signed for the beneficiary. */
  beneficiarySignatory?: string | null;
}

/** Document type codes with a specimen; `COC_SIGNED_COPY` is the beneficiary's paper copy. */
export const DEMO_DOCUMENT_CODES = [
  "CONTRACT",
  "AWARD_LETTER",
  "ACCEPTANCE_LETTER",
  "KICKOFF_BRIEFING_PACK",
  "KICKOFF_NOTICE_RECEIPT",
  "KICKOFF_MINUTES",
  "MOBILISATION_AGREEMENT",
  "MOBILISATION_PLAN",
  "PROGRAMME_OF_WORKS",
  "LETTER_OF_INTRODUCTION",
  "SITE_POSSESSION_FORM",
  "SUPERVISOR_ASSIGNMENT",
  "CP_EVIDENCE",
  "COMPLETION_CERTIFICATE",
  "HANDOVER_CERTIFICATE",
  "FINAL_EVALUATION_REPORT",
  "CLOSEOUT_REPORT",
  "CLOSURE_FILE",
  "OTHER",
  "COC_SIGNED_COPY",
] as const;
export type DemoDocumentCode = (typeof DEMO_DOCUMENT_CODES)[number];

type Doc = InstanceType<typeof PDFDocument>;

const INK = "#1e293b";
const MUTED = "#64748b";
const ACCENT = "#14532d";
const LEFT = 56;
const RIGHT = 539;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-04-01" → "01 Apr 2026". */
export function demoDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "[date]";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}
const ngn = (n: number | null | undefined) => (n === null || n === undefined ? "[contract sum]" : `NGN ${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`);

interface Spec {
  title: string;
  /** Short reference printed under the letterhead. */
  ref?: string;
  /** Letter recipient block. */
  to?: string[];
  paragraphs?: string[];
  facts?: Array<[string, string]>;
  bullets?: string[];
  table?: { head: string[]; rows: string[][]; widths: number[] };
  signatures: string[];
}

function words(c: DemoDocumentContext) {
  const project = c.projectName ?? "the project";
  const school = c.school ?? "the beneficiary school";
  const contractor = c.contractor ?? "the contractor";
  const where = [c.lga ? `${c.lga} LGA` : null, c.state].filter(Boolean).join(", ") || "the project site";
  const ref = c.contractReference ?? "UBEC/DI/[ref]";
  const code = c.projectCode ? ` (${c.projectCode})` : "";
  return { project, school, contractor, where, ref, code };
}

function specFor(code: DemoDocumentCode, c: DemoDocumentContext): Spec {
  const w = words(c);
  const days = c.mobilisationDays ?? 21;
  const scope = c.scope && c.scope.length ? c.scope : ["Works as described in the bill of quantities attached to the contract."];
  switch (code) {
    case "AWARD_LETTER":
      return {
        title: "Letter of award",
        ref: `${w.ref}/AWD`,
        to: ["The Managing Director", w.contractor],
        paragraphs: [
          `Following the procurement process for ${w.project}${w.code}, the Universal Basic Education Commission is pleased to award you the contract for the works at ${w.school}, ${w.where}, for the sum of ${ngn(c.contractSumNgn)} inclusive of taxes.`,
          "The award is made under the Direct Intervention programme and is subject to the general and special conditions of contract, the bill of quantities and the drawings issued with the tender.",
          "Confirm your acceptance in writing within three (3) days of this letter. The contract agreement will be signed after acceptance, and the kick-off meeting will be called by the UBEC State Office.",
        ],
        signatures: ["Director, Physical Planning, for the Executive Secretary"],
      };
    case "ACCEPTANCE_LETTER":
      return {
        title: "Acceptance of award",
        ref: `${w.ref}/ACC`,
        to: ["The Executive Secretary", "Universal Basic Education Commission"],
        paragraphs: [
          `We acknowledge receipt of your letter of award${c.awardDate ? ` dated ${demoDate(c.awardDate)}` : ""} for ${w.project}${w.code} at ${w.school}.`,
          `${w.contractor} accepts the award for the sum of ${ngn(c.contractSumNgn)} and the conditions stated in it, and is ready to sign the contract agreement and attend the kick-off meeting.`,
          "Our site representative and contact details are given in the attached mobilisation plan.",
        ],
        signatures: [`Managing Director, for ${w.contractor}`],
      };
    case "CONTRACT":
      return {
        title: "Contract agreement (summary)",
        ref: w.ref,
        facts: [
          ["Employer", "Universal Basic Education Commission (UBEC)"],
          ["Contractor", w.contractor],
          ["Project", `${w.project}${w.code}`],
          ["Site", `${w.school}, ${w.where}`],
          ["Contract sum", ngn(c.contractSumNgn)],
          ["Signed", demoDate(c.signedDate ?? c.date)],
          ["Mobilisation", `Within ${days} days of the kick-off meeting`],
          ["Retention", "5% of each payment, released after the defects liability period (12 months)"],
        ],
        bullets: scope,
        signatures: ["For the Employer: Executive Secretary, UBEC", `For the Contractor: Managing Director, ${w.contractor}`, "Witness"],
      };
    case "KICKOFF_BRIEFING_PACK":
      return {
        title: "Kick-off meeting: agenda and briefing pack",
        ref: `${w.ref}/KO`,
        facts: [
          ["Project", `${w.project}${w.code}`],
          ["Date", demoDate(c.kickoffDate ?? c.date)],
          ["Venue", `${w.school}, ${w.where}`],
        ],
        bullets: [
          "Introductions: UBEC State Office, M&E, contractor, school management and community",
          "Scope of works, work phases and the programme of works",
          `Mobilisation: personnel, equipment and site office within ${days} days`,
          "Health and safety on site, including PPE for every worker",
          "Monitoring visits, reporting and the letter of introduction to the head teacher",
          "Any other business",
        ],
        signatures: ["Prepared by: UBEC State Office (Physical Planning)"],
      };
    case "KICKOFF_NOTICE_RECEIPT":
      return {
        title: "Kick-off notice: proof of delivery",
        ref: `${w.ref}/KO/N`,
        paragraphs: [`The kick-off notice for ${w.project}${w.code} was delivered by hand to the invitees listed below.`],
        table: { head: ["Invitee", "Received on", "Signature"], rows: [["Contractor", demoDate(c.date), ""], ["Head teacher", demoDate(c.date), ""], ["Community representative", demoDate(c.date), ""]], widths: [200, 120, 163] },
        signatures: ["Delivered by: UBEC State Office"],
      };
    case "KICKOFF_MINUTES":
      return {
        title: `Minutes of the kick-off meeting, ${demoDate(c.kickoffDate ?? c.date)}`,
        ref: `${w.ref}/KO/MIN`,
        facts: [
          ["Project", `${w.project}${w.code}`],
          ["Venue", `${w.school}, ${w.where}`],
          ["Present", "UBEC State Office (owner), UBEC M&E, the contractor, the head teacher (beneficiary)"],
        ],
        bullets: [
          "The scope, contract sum and work phases were presented and accepted by all parties.",
          `The contractor confirmed it will mobilise within ${days} days: site office, signboard, key personnel and equipment.`,
          "PPE (helmets, boots, high-visibility vests) is mandatory for every worker on site; checked on every visit.",
          "The school will keep pupils clear of the works area; the contractor will fence or hoard the site.",
          `The Resident Supervisor${c.residentSupervisor ? ` (${c.residentSupervisor})` : ""} will carry out the mobilisation check and weekly monitoring visits.`,
          "Quorum: owner, monitor, contractor and beneficiary present.",
        ],
        signatures: ["Chair: UBEC State Office", "UBEC M&E Officer", `For ${w.contractor}`, `Head teacher, ${w.school}`],
      };
    case "MOBILISATION_AGREEMENT":
      return {
        title: "Mobilisation agreement",
        ref: `${w.ref}/MOB`,
        paragraphs: [`Agreement between UBEC and ${w.contractor} on the mobilisation for ${w.project}${w.code} at ${w.school}.`],
        bullets: [
          `The contractor will be on site, with its site office and signboard in place, within ${days} days of the kick-off${c.kickoffDate ? ` (by ${demoDate(addDaysIso(c.kickoffDate, days))})` : ""}.`,
          "Key personnel named in the bid (site engineer, foreman) will be on site full time.",
          "Listed equipment and the first materials will be delivered before works start.",
          "Health and safety: every worker on site wears PPE (helmet, safety boots, high-visibility vest) at all times. PPE is checked on every visit and a breach is recorded as a finding.",
          "The site is fenced or hoarded before excavation starts; pupils are kept out of the works area.",
          "The Resident Supervisor confirms mobilisation on site; the first accepted mobilisation check completes the milestone.",
        ],
        signatures: ["For UBEC: State Office Coordinator", `For ${w.contractor}: Managing Director`],
      };
    case "MOBILISATION_PLAN":
      return {
        title: "Mobilisation plan",
        ref: `${w.ref}/MOBP`,
        table: {
          head: ["Item", "Detail", "On site by"],
          rows: [
            ["Site office and signboard", "Container office at the school gate", `Day 7`],
            ["Key personnel", "Site engineer (COREN), foreman, storekeeper", "Day 7"],
            ["Equipment", "Concrete mixer, vibrator, drilling rig (borehole)", "Day 14"],
            ["First materials", "Cement, sand, granite, blocks", "Day 14"],
            ["Safety", "PPE for all workers, first-aid box, hoarding", "Day 7"],
          ],
          widths: [140, 243, 100],
        },
        signatures: [`Site engineer, for ${w.contractor}`],
      };
    case "PROGRAMME_OF_WORKS": {
      const rows = (c.sprints ?? []).map((s) => [s.name, `${demoDate(s.startDate)} – ${demoDate(s.endDate)}`, s.deliverables ?? ""]);
      return {
        title: "Programme of works",
        ref: `${w.ref}/POW`,
        paragraphs: [`The contractor's programme for ${w.project}${w.code}, by work phase. Weather float is included for the rainy season.`],
        table: { head: ["Work phase", "Dates", "Deliverables"], rows: rows.length ? rows : [["Work phase 1", "[dates]", "Substructure and borehole drilling"], ["Work phase 2", "[dates]", "Superstructure, installation and testing"]], widths: [80, 150, 253] },
        signatures: [`Prepared by: site engineer, ${w.contractor}`, "Accepted for UBEC: Resident Supervisor"],
      };
    }
    case "LETTER_OF_INTRODUCTION":
      return {
        title: "Letter of introduction",
        ref: `${w.ref}/LOI`,
        to: ["The Head Teacher", w.school, w.where],
        paragraphs: [
          `This letter introduces ${w.contractor}, appointed by the Universal Basic Education Commission to carry out ${w.project} at your school under contract ${w.ref}.`,
          `The contractor will mobilise to site within ${days} days of the kick-off meeting. Please give its staff access to the agreed works area and help keep pupils clear of it.`,
          `The works are supervised by the UBEC Resident Supervisor${c.residentSupervisor ? `, ${c.residentSupervisor},` : ""} who will visit the site regularly. Raise any concern with the Resident Supervisor or the UBEC State Office.`,
        ],
        signatures: ["UBEC State Office Coordinator"],
      };
    case "SITE_POSSESSION_FORM":
      return {
        title: "Site possession form",
        ref: `${w.ref}/SPF`,
        paragraphs: [`The site at ${w.school}, ${w.where}, was handed to ${w.contractor} for ${w.project}${w.code} on ${demoDate(c.date)}.`],
        facts: [
          ["Works area", "As marked on the site plan; school buildings in use stay outside it"],
          ["Existing services", "Water point and power line located and marked"],
          ["Condition", "Site walked and photographed with the head teacher and the contractor"],
        ],
        signatures: ["Handed over by: UBEC Resident Supervisor", `Received by: ${w.contractor}`, `Witness: Head teacher, ${w.school}`],
      };
    case "SUPERVISOR_ASSIGNMENT":
      return {
        title: "Assignment of the Resident Supervisor",
        ref: `${w.ref}/SUP`,
        paragraphs: [
          `${c.residentSupervisor ?? "The UBEC Resident Supervisor"} is assigned as Resident Supervisor for ${w.project}${w.code} at ${w.school}, with effect from ${demoDate(c.date)}.`,
          "Duties: the mobilisation check, weekly monitoring visits recorded in the field app, confirming the contractor's progress against the work phases, and reporting findings to the UBEC M&E Officer.",
          c.meOfficer ? `Reports are reviewed by the UBEC M&E Officer, ${c.meOfficer}.` : "Reports are reviewed by the UBEC M&E Officer.",
        ],
        signatures: ["Director, Physical Planning, UBEC"],
      };
    case "CP_EVIDENCE":
      return {
        title: "Condition precedent: evidence",
        ref: `${w.ref}/CP`,
        paragraphs: [`Evidence that the stated condition precedent for ${w.project}${w.code} is satisfied.`],
        signatures: ["UBEC Physical Planning"],
      };
    case "COMPLETION_CERTIFICATE":
    case "COC_SIGNED_COPY":
      return {
        title: code === "COC_SIGNED_COPY" ? "Certificate of Completion: copy signed for the beneficiary" : "Certificate of Completion",
        ref: `${w.ref}/COC`,
        paragraphs: [
          `This certifies that the works for ${w.project}${w.code} at ${w.school}, carried out by ${w.contractor} under contract ${w.ref}, were completed on ${demoDate(c.date)} in accordance with the contract.`,
        ],
        bullets: scope,
        signatures: [
          "Director, Physical Planning, UBEC",
          "Director, Monitoring & Evaluation, UBEC",
          code === "COC_SIGNED_COPY" ? `For the beneficiary: ${c.beneficiarySignatory ?? "Head teacher"} (signed on paper)` : "For the beneficiary institution",
        ],
      };
    case "HANDOVER_CERTIFICATE":
      return {
        title: "Handover certificate",
        ref: `${w.ref}/HO`,
        paragraphs: [`The completed works for ${w.project}${w.code} were handed over to ${w.school} on ${demoDate(c.date)}. The defects liability period starts on the date of practical completion.`],
        signatures: ["For UBEC", `For ${w.school}`, `For ${w.contractor}`],
      };
    case "FINAL_EVALUATION_REPORT":
      return {
        title: "Final evaluation report",
        ref: `${w.ref}/FE`,
        facts: [
          ["Project", `${w.project}${w.code}`],
          ["Evaluated on", demoDate(c.date)],
          ["Overall", "Delivered to specification; facilities in use"],
        ],
        bullets: ["Every facility unit inspected and photographed.", "No outstanding major findings.", "Beneficiary satisfied with the works; minor punch list items tracked as defects."],
        signatures: ["UBEC M&E Officer"],
      };
    case "CLOSEOUT_REPORT":
      return {
        title: "Lessons learned report",
        ref: `${w.ref}/CLO`,
        facts: [
          ["Project", `${w.project}${w.code}`],
          ["School", w.school],
          ["Contractor", w.contractor],
          ["Report date", demoDate(c.date)],
        ],
        bullets: [
          "Final evaluation: works delivered to specification; all facilities in use.",
          "Defects liability period: defects raised at handover closed with site photographs.",
          "Payments: final payment and retention release recorded; no exceptions outstanding.",
          "Lessons learned: plan the rainy season into the programme of works; check PPE from the first monitoring visit.",
          "Beneficiary feedback: the school reports the facilities are in daily use.",
        ],
        signatures: ["UBEC M&E Officer", "Director, Physical Planning"],
      };
    case "CLOSURE_FILE":
      return {
        title: "Project closure file: cover sheet",
        ref: `${w.ref}/CF`,
        paragraphs: [`Closure file for ${w.project}${w.code}: contract documents, certificates, monitoring reports, payments and the audit ledger.`],
        signatures: ["UBEC Audit Department"],
      };
    case "OTHER":
    default:
      return {
        title: "Project document",
        ref: `${w.ref}/DOC`,
        paragraphs: [`Supporting document for ${w.project}${w.code} at ${w.school}.`],
        signatures: ["UBEC"],
      };
  }
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function draw(doc: Doc, spec: Spec, c: DemoDocumentContext) {
  // Letterhead.
  doc.font("Helvetica-Bold").fontSize(15).fillColor(ACCENT).text("Universal Basic Education Commission", LEFT, 50);
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text("Federal Republic of Nigeria · Abuja");
  doc.moveDown(0.4);
  doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).lineWidth(1.2).strokeColor(ACCENT).stroke();
  doc.moveDown(0.6);
  const meta = [spec.ref ? `Ref: ${spec.ref}` : null, `Date: ${demoDate(c.date)}`].filter(Boolean).join("     ");
  doc.fontSize(9).fillColor(MUTED).text(meta, LEFT);
  doc.moveDown(0.8);
  if (spec.to) {
    doc.fontSize(10).fillColor(INK);
    for (const l of spec.to) doc.text(l);
    doc.moveDown(0.8);
  }
  doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text(spec.title);
  doc.font("Helvetica").moveDown(0.6);

  doc.fontSize(10).fillColor(INK);
  for (const p of spec.paragraphs ?? []) {
    doc.text(p, { align: "left", lineGap: 2 });
    doc.moveDown(0.6);
  }
  for (const [label, value] of spec.facts ?? []) {
    doc.font("Helvetica-Bold").fillColor(MUTED).text(`${label}: `, { continued: true }).font("Helvetica").fillColor(INK).text(value, { lineGap: 1.5 });
  }
  if (spec.facts?.length) doc.moveDown(0.6);
  for (const b of spec.bullets ?? []) {
    doc.text(`•  ${b}`, LEFT + 6, doc.y, { indent: 0, lineGap: 1.5, width: RIGHT - LEFT - 6 });
    doc.moveDown(0.2);
  }
  if (spec.bullets?.length) doc.moveDown(0.4);
  if (spec.table) {
    const { head, rows, widths } = spec.table;
    const row = (cells: string[], bold: boolean) => {
      const y = doc.y;
      let x = LEFT;
      let h = 0;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(bold ? MUTED : INK);
      cells.forEach((cell, i) => {
        const height = doc.heightOfString(cell || " ", { width: widths[i] - 8 });
        doc.text(cell, x + 4, y + 3, { width: widths[i] - 8 });
        h = Math.max(h, height);
        x += widths[i];
      });
      doc.y = y + h + 6;
      doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).lineWidth(0.5).strokeColor("#cbd5e1").stroke();
    };
    row(head, true);
    for (const r of rows) row(r, false);
    doc.font("Helvetica").fontSize(10);
    doc.x = LEFT;
    doc.moveDown(0.8);
  }

  // Signature lines, two per row.
  doc.x = LEFT;
  doc.moveDown(1.2);
  const colW = (RIGHT - LEFT - 30) / 2;
  for (let i = 0; i < spec.signatures.length; i += 2) {
    if (doc.y > 700) doc.addPage();
    const y = doc.y + 24;
    spec.signatures.slice(i, i + 2).forEach((label, j) => {
      const x = LEFT + j * (colW + 30);
      doc.moveTo(x, y).lineTo(x + colW, y).lineWidth(0.6).strokeColor(INK).stroke();
      doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(`${label}`, x, y + 4, { width: colW });
      doc.text("Name, signature and date", x, doc.y, { width: colW });
    });
    doc.x = LEFT;
    doc.y = y + 34;
  }

  // Footer on every page.
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8").text("SPECIMEN – demo data. Not a real document.", LEFT, 800, { width: RIGHT - LEFT, align: "center", lineBreak: false });
  }
}

/** The register title a seeded or demo document of this type gets (more specific than the type name). */
export function demoDocumentTitle(code: DemoDocumentCode, c: DemoDocumentContext = {}): string {
  const school = c.school ?? null;
  switch (code) {
    case "CONTRACT":
      return c.contractReference ? `Contract agreement ${c.contractReference}` : "Contract agreement";
    case "AWARD_LETTER":
      return c.awardDate ? `Letter of award, ${demoDate(c.awardDate)}` : "Letter of award";
    case "ACCEPTANCE_LETTER":
      return c.contractor ? `Acceptance of award, ${c.contractor}` : "Acceptance of award";
    case "KICKOFF_BRIEFING_PACK":
      return "Kick-off agenda and briefing pack";
    case "KICKOFF_NOTICE_RECEIPT":
      return "Kick-off notice, proof of delivery";
    case "KICKOFF_MINUTES":
      return `Kick-off meeting minutes, ${demoDate(c.kickoffDate ?? c.date)}`;
    case "MOBILISATION_AGREEMENT":
      return "Mobilisation agreement (incl. PPE on site)";
    case "MOBILISATION_PLAN":
      return "Contractor's mobilisation plan";
    case "PROGRAMME_OF_WORKS":
      return "Programme of works, by work phase";
    case "LETTER_OF_INTRODUCTION":
      return "Letter of introduction to the Head Teacher";
    case "SITE_POSSESSION_FORM":
      return c.date ? `Site possession form, ${demoDate(c.date)}` : "Site possession form";
    case "SUPERVISOR_ASSIGNMENT":
      return c.residentSupervisor ? `Resident Supervisor assignment, ${c.residentSupervisor}` : "Resident Supervisor assignment";
    case "CP_EVIDENCE":
      return "Condition precedent evidence";
    case "COMPLETION_CERTIFICATE":
      return "Certificate of Completion";
    case "COC_SIGNED_COPY":
      return "Certificate of Completion, signed paper copy";
    case "HANDOVER_CERTIFICATE":
      return "Handover certificate";
    case "FINAL_EVALUATION_REPORT":
      return school ? `Final evaluation report, ${school}` : "Final evaluation report";
    case "CLOSEOUT_REPORT":
      return school ? `Lessons learned report: ${school}` : "Lessons learned report";
    case "CLOSURE_FILE":
      return "Project closure file";
    default:
      return "Project document";
  }
}

/** Renders the specimen PDF for a document type. Deterministic for the same input (fixed metadata dates). */
export function renderDemoDocument(code: string, context: DemoDocumentContext = {}): Promise<Buffer> {
  const known = (DEMO_DOCUMENT_CODES as readonly string[]).includes(code) ? (code as DemoDocumentCode) : "OTHER";
  const spec = specFor(known, context);
  const stamp = new Date(`${(context.date && /^\d{4}-\d{2}-\d{2}/.test(context.date) ? context.date.slice(0, 10) : "2026-01-01")}T09:00:00Z`);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 30, left: LEFT, right: 595 - RIGHT },
      bufferPages: true,
      compress: true,
      info: { Title: spec.title, Author: "Universal Basic Education Commission (specimen)", Creator: "InSite Assurance demo data", CreationDate: stamp, ModDate: stamp },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      draw(doc, spec, context);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/** One generic specimen per type, rendered once per process (the seed reuses it across projects). */
const genericCache = new Map<string, Promise<Buffer>>();
export function genericDemoDocument(code: string): Promise<Buffer> {
  let p = genericCache.get(code);
  if (!p) {
    p = renderDemoDocument(code, {});
    genericCache.set(code, p);
  }
  return p;
}
