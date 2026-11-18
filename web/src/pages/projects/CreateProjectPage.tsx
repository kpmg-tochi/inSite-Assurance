import React, { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  BoqItemInput,
  CreateProjectRequest,
  ReportingCadence,
} from "@insite/shared";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  MapPin,
  Plus,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import type { ProjectSummaryDto } from "../../api/types";
import { uploadProjectBoq } from "../../api/boq/boqApi";
import { useCreateProjectMutation } from "../../mutations/projects/useProjectsMutations";
import { formatCompactNaira } from "../../lib/formatters";
import { IS_DEMO_MODE } from "../../config/demoMode";
import { CustomSelect, type CustomSelectOption } from "../../components/common";

interface CreateProjectPageProps {
  onProjectCreated: (project: ProjectSummaryDto) => void;
  cancelFallbackPath: string;
}

interface DraftCp {
  referenceCode: string;
  description: string;
  isMandatoryForRelease: boolean;
  status: "PENDING" | "SATISFIED";
}

interface DraftTranche {
  trancheNumber: number;
  name: string;
  allocatedAmountNgn: string;
  targetCompletionPct: string;
  conditionsPrecedent: DraftCp[];
}

interface DraftBoqRow {
  localId: string;
  wbsCode: string;
  section: string;
  description: string;
  unit: string;
  totalQuantity: string;
  rateNgn: string;
  isHoldPoint: boolean;
  holdPointInstruction: string;
}

const SAMPLE_WBS_ROWS: Omit<DraftBoqRow, "localId">[] = [
  {
    wbsCode: "01.01.1",
    section: "BILL NO. 1 — SITE CLEARANCE & EARTHWORKS",
    description:
      "Clear site corridor, strip topsoil, and compact laterite sub-grade to 98% BS MDD",
    unit: "m3",
    totalQuantity: "12500",
    rateNgn: "18500",
    isHoldPoint: false,
    holdPointInstruction: "",
  },
  {
    wbsCode: "02.01.1",
    section: "BILL NO. 2 — DRAINAGE & BOX CULVERTS",
    description:
      "Supply, cut, bend, and fix Y16/Y20 High-Yield Steel Reinforcement for Box Culverts",
    unit: "tons",
    totalQuantity: "145",
    rateNgn: "1450000",
    isHoldPoint: true,
    holdPointInstruction:
      "Capture geotagged photo of tied reinforcement & spacers plus Mill Certificate prior to pour.",
  },
  {
    wbsCode: "02.01.2",
    section: "BILL NO. 2 — DRAINAGE & BOX CULVERTS",
    description:
      "Provide and place Grade C30 ready-mix structural concrete in Box Culvert walls & deck slab",
    unit: "m3",
    totalQuantity: "1800",
    rateNgn: "195000",
    isHoldPoint: true,
    holdPointInstruction:
      "Capture concrete slump cone reading at pour and 28-day cube crushing certificate.",
  },
];

function createRowId(): string {
  return `boq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsvTextToBoqRows(csvText: string): DraftBoqRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const findCol = (candidates: string[]) =>
    headers.findIndex((h) => candidates.some((c) => h.includes(c)));

  const wbsIdx = findCol(["wbs", "code", "item no"]);
  const sectionIdx = findCol(["section", "bill"]);
  const descIdx = findCol(["description", "work item", "item"]);
  const unitIdx = findCol(["unit"]);
  const qtyIdx = findCol(["quantity", "qty"]);
  const rateIdx = findCol(["rate"]);
  const hpIdx = findCol(["hold", "holdpoint"]);

  const parsed: DraftBoqRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const description = descIdx >= 0 ? cols[descIdx] || "" : "";
    if (!description || description.length < 3) continue;

    const hpRaw = hpIdx >= 0 ? (cols[hpIdx] || "").toLowerCase() : "";
    const isHoldPoint = ["true", "yes", "1", "y"].includes(hpRaw);

    parsed.push({
      localId: createRowId(),
      wbsCode:
        (wbsIdx >= 0 && cols[wbsIdx]) ||
        `01.${String(i).padStart(2, "0")}`,
      section:
        (sectionIdx >= 0 && cols[sectionIdx]) || "GENERAL CIVIL WORKS",
      description,
      unit: (unitIdx >= 0 && cols[unitIdx]) || "item",
      totalQuantity: String(
        qtyIdx >= 0 && Number(cols[qtyIdx]) > 0 ? Number(cols[qtyIdx]) : 1,
      ),
      rateNgn: String(
        rateIdx >= 0 && Number(cols[rateIdx]) >= 0 ? Number(cols[rateIdx]) : 0,
      ),
      isHoldPoint,
      holdPointInstruction: "",
    });
  }
  return parsed;
}

const REPORTING_CADENCE_OPTIONS: CustomSelectOption<ReportingCadence>[] = [
  {
    value: "DAILY",
    label: "Daily Field Wrap-Up",
    description: "Daily morning briefing and end-of-shift reporting",
  },
  {
    value: "WEEKLY",
    label: "Weekly Progress Pack",
    description: "Weekly consolidated site progress and milestone report",
  },
  {
    value: "BI_WEEKLY",
    label: "Bi-Weekly Milestone",
    description: "Every two weeks aligned with valuation periods",
  },
  {
    value: "INSPECTION_ONLY",
    label: "Inspection Only",
    description: "On-demand reporting triggered by physical milestone inspections",
  },
];

const CP_STATUS_OPTIONS: CustomSelectOption<"PENDING" | "SATISFIED">[] = [
  { value: "PENDING", label: "Pending", badge: "Required" },
  { value: "SATISFIED", label: "Satisfied" },
];

export function CreateProjectPage({
  onProjectCreated,
  cancelFallbackPath,
}: CreateProjectPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createProjectMutation = useCreateProjectMutation();
  const boqFileInputRef = useRef<HTMLInputElement>(null);

  // Section 1: Project Identity & Counterparties
  const [name, setName] = useState("");
  const [codePrefix, setCodePrefix] = useState(IS_DEMO_MODE ? "KAD-205" : "");
  const [stateLocation, setStateLocation] = useState(
    IS_DEMO_MODE ? "Kaduna State" : "",
  );
  const [lgaLocation, setLgaLocation] = useState("Municipal Corridor");
  const [description, setDescription] = useState("");
  const [totalBudgetNgn, setTotalBudgetNgn] = useState("8500000000");
  const [reportingCadence, setReportingCadence] =
    useState<ReportingCadence>("WEEKLY");
  const [workdayStartTime, setWorkdayStartTime] = useState("08:00");
  const [workdayEndTime, setWorkdayEndTime] = useState("17:00");
  const [lenderOrganizationName, setLenderOrganizationName] =
    useState("InfraCredit");
  const [contractorOrganizationName, setContractorOrganizationName] =
    useState("J&S Civil Eng.");

  // Section 2: Physical Site Geofence
  const [geofenceMode, setGeofenceMode] = useState<
    "LINEAR_CORRIDOR" | "RADIAL"
  >("LINEAR_CORRIDOR");
  const [corridorHalfWidthMeters, setCorridorHalfWidthMeters] = useState("150");
  const [startChainageKm, setStartChainageKm] = useState("0");
  const [waypoints, setWaypoints] = useState<
    Array<{ longitude: string; latitude: string }>
  >([
    { longitude: "7.4295", latitude: "10.5105" },
    { longitude: "7.4450", latitude: "10.5250" },
    { longitude: "7.4620", latitude: "10.5410" },
  ]);
  const [radialLabel, setRadialLabel] = useState("Primary Site Compound");
  const [radialLat, setRadialLat] = useState("9.0579");
  const [radialLng, setRadialLng] = useState("7.4951");
  const [radialRadiusMeters, setRadialRadiusMeters] = useState("600");

  // Section 3: Project Tranches & Conditions Precedent
  const [tranches, setTranches] = useState<DraftTranche[]>([
    {
      trancheNumber: 1,
      name: "Tranche 1: Mobilization & Sub-structure",
      allocatedAmountNgn: "2975000000",
      targetCompletionPct: "35",
      conditionsPrecedent: [
        {
          referenceCode: "CP-01",
          description:
            "Execution of Performance Bond and Advance Payment Guarantee",
          isMandatoryForRelease: true,
          status: "SATISFIED",
        },
        {
          referenceCode: "CP-02",
          description:
            "Independent Monitor verification of right-of-way handover",
          isMandatoryForRelease: true,
          status: "SATISFIED",
        },
      ],
    },
    {
      trancheNumber: 2,
      name: "Tranche 2: Superstructure & Civil Works",
      allocatedAmountNgn: "5525000000",
      targetCompletionPct: "100",
      conditionsPrecedent: [
        {
          referenceCode: "CP-03",
          description:
            "Zero unresolved Hold-Point non-conformances on Tranche 1 works",
          isMandatoryForRelease: true,
          status: "PENDING",
        },
      ],
    },
  ]);

  // Section 4: BOQ & WBS Setup
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [spreadsheetBase64, setSpreadsheetBase64] = useState<string | null>(
    null,
  );
  const [boqRows, setBoqRows] = useState<DraftBoqRow[]>([]);
  const [submittingStage, setSubmittingStage] = useState<
    "IDLE" | "CREATING_PROJECT" | "INGESTING_BOQ"
  >("IDLE");

  const budgetNumeric = Number(totalBudgetNgn) || 0;
  const normalizedCodePrefix = codePrefix.trim().toUpperCase();
  const isCodePrefixValid = /^[A-Z0-9]{3}-[0-9]{3}$/.test(normalizedCodePrefix);

  const computedBoqTotalNgn = useMemo(
    () =>
      boqRows.reduce(
        (sum, r) =>
          sum + (Number(r.totalQuantity) || 0) * (Number(r.rateNgn) || 0),
        0,
      ),
    [boqRows],
  );

  const handleBudgetBlur = () => {
    if (budgetNumeric <= 0) return;
    // Keep tranche default split proportional when only 2 standard tranches exist and untouched
    if (
      tranches.length === 2 &&
      tranches[0].targetCompletionPct === "35" &&
      tranches[1].targetCompletionPct === "100"
    ) {
      setTranches((prev) => [
        {
          ...prev[0],
          allocatedAmountNgn: String(Math.round(budgetNumeric * 0.35)),
        },
        {
          ...prev[1],
          allocatedAmountNgn: String(Math.round(budgetNumeric * 0.65)),
        },
      ]);
    }
  };

  const handleAddTranche = () => {
    const nextNum = tranches.length + 1;
    setTranches((prev) => [
      ...prev,
      {
        trancheNumber: nextNum,
        name: `Tranche ${nextNum}: Phase ${nextNum} Milestone Works`,
        allocatedAmountNgn: String(Math.round((budgetNumeric || 1_000_000_000) * 0.25)),
        targetCompletionPct: "100",
        conditionsPrecedent: [],
      },
    ]);
  };

  const handleRemoveTranche = (idx: number) => {
    if (tranches.length <= 1) return;
    setTranches((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((t, i) => ({ ...t, trancheNumber: i + 1 })),
    );
  };

  const handleAddCp = (trancheIdx: number) => {
    setTranches((prev) =>
      prev.map((t, idx) => {
        if (idx !== trancheIdx) return t;
        const cpCount = prev.reduce(
          (sum, item) => sum + item.conditionsPrecedent.length,
          0,
        );
        return {
          ...t,
          conditionsPrecedent: [
            ...t.conditionsPrecedent,
            {
              referenceCode: `CP-${String(cpCount + 1).padStart(2, "0")}`,
              description: "",
              isMandatoryForRelease: true,
              status: "PENDING",
            },
          ],
        };
      }),
    );
  };

  const handleSpreadsheetSelected = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFileName(file.name);

    const isCsv = file.name.toLowerCase().endsWith(".csv");
    if (isCsv) {
      const textReader = new FileReader();
      textReader.onload = () => {
        const csvText = String(textReader.result || "");
        const parsedRows = parseCsvTextToBoqRows(csvText);
        if (parsedRows.length > 0) {
          setBoqRows(parsedRows);
          setSpreadsheetBase64(null);
          toast.success(
            `Parsed ${parsedRows.length} WBS rows from "${file.name}". Review or toggle Hold-Points below before submitting.`,
          );
          return;
        }
        // Fallback to server base64 parser
        const base64Reader = new FileReader();
        base64Reader.onload = () => {
          setSpreadsheetBase64(String(base64Reader.result).split(",")[1] || "");
        };
        base64Reader.readAsDataURL(file);
      };
      textReader.readAsText(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] || "";
      setSpreadsheetBase64(base64);
      toast.success(
        `Attached "${file.name}" for server-side BOQ parsing & AI Hold-Point screening.`,
      );
    };
    reader.readAsDataURL(file);
  };

  const handleDownloadSampleTemplate = () => {
    const csvLines = [
      "WBS,Section,Description,Unit,Quantity,Rate,Amount,HoldPoint",
      ...SAMPLE_WBS_ROWS.map((r) => {
        const amt = (Number(r.totalQuantity) || 0) * (Number(r.rateNgn) || 0);
        return [
          `"${r.wbsCode}"`,
          `"${r.section}"`,
          `"${r.description.replace(/"/g, '""')}"`,
          `"${r.unit}"`,
          r.totalQuantity,
          r.rateNgn,
          amt,
          r.isHoldPoint ? "true" : "false",
        ].join(",");
      }),
    ].join("\n");

    const blob = new Blob([csvLines], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "insite-boq-wbs-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleAddBoqRow = () => {
    const nextCode = `01.${String(boqRows.length + 1).padStart(2, "0")}.1`;
    setBoqRows((prev) => [
      ...prev,
      {
        localId: createRowId(),
        wbsCode: nextCode,
        section: "BILL NO. 1 — GENERAL CIVIL WORKS",
        description: "",
        unit: "m3",
        totalQuantity: "100",
        rateNgn: "25000",
        isHoldPoint: false,
        holdPointInstruction: "",
      },
    ]);
  };

  const handleLoadSampleWbs = () => {
    setUploadedFileName(null);
    setSpreadsheetBase64(null);
    setBoqRows(SAMPLE_WBS_ROWS.map((r) => ({ ...r, localId: createRowId() })));
    toast.info("Loaded 3 sample WBS items into the BOQ builder.");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (name.trim().length < 3) {
      toast.error("Please enter a project name (at least 3 characters).");
      return;
    }
    if (!isCodePrefixValid) {
      toast.error("Code Prefix must follow format XXX-000 (e.g. KAD-205).");
      return;
    }
    if (budgetNumeric <= 0) {
      toast.error("Total project budget must be greater than zero.");
      return;
    }

    const structuredBoqItems: BoqItemInput[] = boqRows
      .filter((r) => r.description.trim().length >= 3 && r.wbsCode.trim())
      .map((r) => {
        const qty = Math.max(0.01, Number(r.totalQuantity) || 1);
        const rate = Math.max(0, Number(r.rateNgn) || 0);
        return {
          wbsCode: r.wbsCode.trim(),
          section: r.section.trim() || "GENERAL CIVIL WORKS",
          description: r.description.trim(),
          unit: r.unit.trim() || "item",
          totalQuantity: qty,
          rateNgn: rate,
          budgetedCostNgn: Math.round(qty * rate),
          isHoldPoint: r.isHoldPoint,
          holdPointInstruction: r.isHoldPoint
            ? r.holdPointInstruction.trim() ||
              `Capture geotagged Hold-Point verification proof prior to covering WBS ${r.wbsCode.trim()}.`
            : null,
        };
      });

    const payload: CreateProjectRequest = {
      name: name.trim(),
      codePrefix: normalizedCodePrefix,
      stateLocation: stateLocation.trim(),
      lgaLocation: lgaLocation.trim() || undefined,
      description:
        description.trim() ||
        `${name.trim()} capital infrastructure monitoring baseline.`,
      totalBudgetNgn: budgetNumeric,
      reportingCadence,
      workdayStartTime,
      workdayEndTime,
      lenderOrganizationName: lenderOrganizationName.trim() || "InfraCredit",
      contractorOrganizationName:
        contractorOrganizationName.trim() || "J&S Civil Eng.",
      geofence:
        geofenceMode === "LINEAR_CORRIDOR"
          ? {
              mode: "LINEAR_CORRIDOR",
              corridorHalfWidthMeters: Math.max(
                10,
                Number(corridorHalfWidthMeters) || 150,
              ),
              startChainageKm: Number(startChainageKm) || 0,
              centerlineCoordinates: waypoints
                .map(
                  (w) =>
                    [Number(w.longitude) || 0, Number(w.latitude) || 0] as [
                      number,
                      number,
                    ],
                )
                .filter(([lng, lat]) => lng !== 0 && lat !== 0),
            }
          : {
              mode: "RADIAL",
              siteLabel: radialLabel.trim() || `${name.trim()} Site`,
              center: {
                latitude: Number(radialLat) || 9.0579,
                longitude: Number(radialLng) || 7.4951,
              },
              radiusMeters: Math.max(25, Number(radialRadiusMeters) || 600),
            },
      tranches: tranches.map((t, idx) => ({
        trancheNumber: idx + 1,
        name: t.name.trim() || `Tranche ${idx + 1}`,
        allocatedAmountNgn: Math.max(1, Number(t.allocatedAmountNgn) || 1),
        targetCompletionPct: Math.min(
          100,
          Math.max(0, Number(t.targetCompletionPct) || 50),
        ),
        conditionsPrecedent: t.conditionsPrecedent
          .filter((cp) => cp.description.trim().length >= 4)
          .map((cp) => ({
            referenceCode: cp.referenceCode.trim() || "CP-01",
            description: cp.description.trim(),
            isMandatoryForRelease: cp.isMandatoryForRelease,
            status: cp.status,
          })),
      })),
    };

    try {
      setSubmittingStage("CREATING_PROJECT");
      const created = await createProjectMutation.mutateAsync(payload);

      if (spreadsheetBase64 || structuredBoqItems.length > 0) {
        setSubmittingStage("INGESTING_BOQ");
        try {
          const boqRes = await uploadProjectBoq({
            projectId: created.id,
            spreadsheetBase64: spreadsheetBase64 || undefined,
            items:
              structuredBoqItems.length > 0 ? structuredBoqItems : undefined,
          });
          await queryClient.invalidateQueries({ queryKey: ["boq", created.id] });
          await queryClient.invalidateQueries({ queryKey: ["projects"] });
          toast.success(
            `Ingested ${boqRes.totalUploaded} BOQ items (${boqRes.holdPointCount} Hold-Points, ${boqRes.opaqueLumpSumCount} Opaque Lump Sums screened).`,
          );
        } catch (boqErr: any) {
          toast.error(
            boqErr?.message ||
              "Project baseline created, but BOQ upload failed — you can retry upload on the BOQ page.",
          );
        }
      }

      onProjectCreated(created);
    } finally {
      setSubmittingStage("IDLE");
    }
  };

  const isBusy = submittingStage !== "IDLE";

  return (
    <form onSubmit={handleSubmit} className="space-y-5 pb-8">
      {/* Page Hero / Summary Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => navigate(cancelFallbackPath)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-primary hover:underline"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Projects</span>
          </button>
          <h1 className="text-xl font-bold text-slate-900">
            Initialize New Capital Project Baseline &amp; BOQ
          </h1>
          <p className="text-xs text-slate-500 max-w-2xl">
            Configure counterparties, site geofence boundaries, project tranches,
            and ingest the Bill of Quantities (BOQ / WBS) with automated AI
            Hold-Point and Lump-Sum screening in one step.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 font-semibold text-slate-700">
            Prefix: {normalizedCodePrefix || "—"}
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 font-semibold text-brand-primary">
            Budget: {budgetNumeric > 0 ? formatCompactNaira(budgetNumeric) : "—"}
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 font-semibold text-emerald-800">
            {spreadsheetBase64
              ? "BOQ Spreadsheet Ready"
              : `${boqRows.length} WBS Item${boqRows.length === 1 ? "" : "s"}`}
          </span>
        </div>
      </div>

      {/* Section 1: Project Identity & Counterparties */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <span className="w-6 h-6 rounded-full bg-brand-primary text-white text-xs font-bold flex items-center justify-center">
            1
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Project Identity, Counterparties &amp; Schedule
            </h2>
            <p className="text-[11px] text-slate-500">
              Establishes project baseline and generates role-segregated mobile
              join codes (-INS, -COW, -CON).
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-3">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Project Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Kaduna Eastern Bypass Dualization Phase II"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Code Prefix <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={codePrefix}
              onChange={(e) => setCodePrefix(e.target.value.toUpperCase())}
              placeholder="KAD-205"
              maxLength={7}
              className={`w-full rounded-xl border px-3.5 py-2 text-xs uppercase font-bold focus:outline-none ${
                codePrefix && !isCodePrefixValid
                  ? "border-red-400 focus:border-red-500"
                  : "border-slate-300 focus:border-brand-primary"
              }`}
            />
            {codePrefix && !isCodePrefixValid && (
              <p className="text-[10px] text-red-600 mt-1">
                Use 3 letters/digits, hyphen, 3 digits (e.g. KAD-205)
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              State / Corridor Location <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={stateLocation}
              onChange={(e) => setStateLocation(e.target.value)}
              placeholder="e.g., Kaduna State"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs focus:outline-none focus:border-brand-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              LGA / Corridor Segment
            </label>
            <input
              type="text"
              value={lgaLocation}
              onChange={(e) => setLgaLocation(e.target.value)}
              placeholder="e.g., Chikun / Igabi LGA"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs focus:outline-none focus:border-brand-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Total Project Budget (₦ NGN) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              required
              min={1}
              value={totalBudgetNgn}
              onChange={(e) => setTotalBudgetNgn(e.target.value)}
              onBlur={handleBudgetBlur}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-semibold focus:outline-none focus:border-brand-primary"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Lender / Guarantor Organization *
            </label>
            <input
              type="text"
              required
              value={lenderOrganizationName}
              onChange={(e) => setLenderOrganizationName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs focus:outline-none focus:border-brand-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Main Contractor Organization *
            </label>
            <input
              type="text"
              required
              value={contractorOrganizationName}
              onChange={(e) => setContractorOrganizationName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs focus:outline-none focus:border-brand-primary"
            />
          </div>
          <div>
            <CustomSelect
              label="Reporting Cadence"
              value={reportingCadence}
              onChange={(newCadence) => setReportingCadence(newCadence)}
              options={REPORTING_CADENCE_OPTIONS}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Start (WAT)
              </label>
              <input
                type="text"
                value={workdayStartTime}
                onChange={(e) => setWorkdayStartTime(e.target.value)}
                placeholder="08:00"
                className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-xs focus:outline-none focus:border-brand-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                End (WAT)
              </label>
              <input
                type="text"
                value={workdayEndTime}
                onChange={(e) => setWorkdayEndTime(e.target.value)}
                placeholder="17:00"
                className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-xs focus:outline-none focus:border-brand-primary"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Project Scope Summary (Optional)
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe civil scope, key structures, and assurance oversight boundaries..."
            className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs focus:outline-none focus:border-brand-primary"
          />
        </div>
      </section>

      {/* Section 2: Site Geofence Configuration */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <span className="w-6 h-6 rounded-full bg-brand-primary text-white text-xs font-bold flex items-center justify-center">
            2
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Geofence Verification Boundary
            </h2>
            <p className="text-[11px] text-slate-500">
              All hourly presence pings and mobile field evidence captures are
              snapped and validated against this boundary.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setGeofenceMode("LINEAR_CORRIDOR")}
            className={`p-4 rounded-xl border text-left transition flex items-start gap-3 ${
              geofenceMode === "LINEAR_CORRIDOR"
                ? "border-brand-primary bg-blue-50/40"
                : "border-slate-200 hover:bg-slate-50"
            }`}
          >
            <MapPin
              className={`w-4 h-4 mt-0.5 ${
                geofenceMode === "LINEAR_CORRIDOR"
                  ? "text-brand-primary"
                  : "text-slate-400"
              }`}
            />
            <div>
              <div className="text-xs font-bold text-slate-900">
                Linear Corridor (KM X+YYY)
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Snaps GPS captures to road, rail, pipeline, or transmission
                centerline chainages.
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setGeofenceMode("RADIAL")}
            className={`p-4 rounded-xl border text-left transition flex items-start gap-3 ${
              geofenceMode === "RADIAL"
                ? "border-brand-primary bg-blue-50/40"
                : "border-slate-200 hover:bg-slate-50"
            }`}
          >
            <Building2
              className={`w-4 h-4 mt-0.5 ${
                geofenceMode === "RADIAL"
                  ? "text-brand-primary"
                  : "text-slate-400"
              }`}
            />
            <div>
              <div className="text-xs font-bold text-slate-900">
                Radial Site Boundary
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Validates captures within a fixed radius around substations,
                solar plants, bridges, or buildings.
              </div>
            </div>
          </button>
        </div>

        {geofenceMode === "LINEAR_CORRIDOR" ? (
          <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Corridor Half-Width Tolerance (meters)
                </label>
                <input
                  type="number"
                  value={corridorHalfWidthMeters}
                  onChange={(e) => setCorridorHalfWidthMeters(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Start Chainage (km)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={startChainageKm}
                  onChange={(e) => setStartChainageKm(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-700">
                  Centerline Waypoints (Longitude / Latitude)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setWaypoints((prev) => [
                      ...prev,
                      { longitude: "7.4750", latitude: "10.5500" },
                    ])
                  }
                  className="text-[11px] font-semibold text-brand-primary hover:underline"
                >
                  + Add Waypoint
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {waypoints.map((wp, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-2"
                  >
                    <span className="text-[10px] font-bold text-slate-400 w-5">
                      P{idx + 1}
                    </span>
                    <input
                      type="text"
                      value={wp.longitude}
                      onChange={(e) =>
                        setWaypoints((prev) =>
                          prev.map((row, rIdx) =>
                            rIdx === idx
                              ? { ...row, longitude: e.target.value }
                              : row,
                          ),
                        )
                      }
                      placeholder="Lng"
                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-[11px]"
                    />
                    <input
                      type="text"
                      value={wp.latitude}
                      onChange={(e) =>
                        setWaypoints((prev) =>
                          prev.map((row, rIdx) =>
                            rIdx === idx
                              ? { ...row, latitude: e.target.value }
                              : row,
                          ),
                        )
                      }
                      placeholder="Lat"
                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-[11px]"
                    />
                    {waypoints.length > 2 && (
                      <button
                        type="button"
                        onClick={() =>
                          setWaypoints((prev) =>
                            prev.filter((_, rIdx) => rIdx !== idx),
                          )
                        }
                        className="text-slate-400 hover:text-red-600 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Site Label
              </label>
              <input
                type="text"
                value={radialLabel}
                onChange={(e) => setRadialLabel(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Center Latitude
              </label>
              <input
                type="number"
                step="0.0001"
                value={radialLat}
                onChange={(e) => setRadialLat(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Center Longitude
              </label>
              <input
                type="number"
                step="0.0001"
                value={radialLng}
                onChange={(e) => setRadialLng(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Site Radius (meters)
              </label>
              <input
                type="number"
                min={25}
                value={radialRadiusMeters}
                onChange={(e) => setRadialRadiusMeters(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
              />
            </div>
          </div>
        )}
      </section>

      {/* Section 3: Project Tranches & Conditions Precedent */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-brand-primary text-white text-xs font-bold flex items-center justify-center">
              3
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Project Tranches &amp; Conditions Precedent (CPs)
              </h2>
              <p className="text-[11px] text-slate-500">
                Defines disbursement milestones mapped to uploaded BOQ work
                items.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleAddTranche}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700"
          >
            <Plus className="w-3.5 h-3.5 text-brand-primary" />
            <span>Add Tranche</span>
          </button>
        </div>

        <div className="space-y-3">
          {tranches.map((tranche, tIdx) => (
            <div
              key={tIdx}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3"
            >
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-6">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Tranche #{tIdx + 1} Name
                  </label>
                  <input
                    type="text"
                    required
                    value={tranche.name}
                    onChange={(e) =>
                      setTranches((prev) =>
                        prev.map((item, i) =>
                          i === tIdx ? { ...item, name: e.target.value } : item,
                        ),
                      )
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Allocation (₦ NGN)
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={tranche.allocatedAmountNgn}
                    onChange={(e) =>
                      setTranches((prev) =>
                        prev.map((item, i) =>
                          i === tIdx
                            ? { ...item, allocatedAmountNgn: e.target.value }
                            : item,
                        ),
                      )
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Target %
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={tranche.targetCompletionPct}
                    onChange={(e) =>
                      setTranches((prev) =>
                        prev.map((item, i) =>
                          i === tIdx
                            ? { ...item, targetCompletionPct: e.target.value }
                            : item,
                        ),
                      )
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  />
                </div>
                <div className="md:col-span-1 flex justify-end">
                  {tranches.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveTranche(tIdx)}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                      title="Remove tranche"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* CPs for Tranche */}
              <div className="space-y-2 pt-2 border-t border-slate-200/80">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-600">
                    Conditions Precedent ({tranche.conditionsPrecedent.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => handleAddCp(tIdx)}
                    className="text-[11px] font-semibold text-brand-primary hover:underline"
                  >
                    + Add Condition Precedent
                  </button>
                </div>
                {tranche.conditionsPrecedent.map((cp, cpIdx) => (
                  <div
                    key={cpIdx}
                    className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center bg-white rounded-xl border border-slate-200 p-2"
                  >
                    <input
                      type="text"
                      value={cp.referenceCode}
                      onChange={(e) =>
                        setTranches((prev) =>
                          prev.map((t, ti) =>
                            ti !== tIdx
                              ? t
                              : {
                                  ...t,
                                  conditionsPrecedent:
                                    t.conditionsPrecedent.map((c, ci) =>
                                      ci === cpIdx
                                        ? {
                                            ...c,
                                            referenceCode: e.target.value,
                                          }
                                        : c,
                                    ),
                                },
                          ),
                        )
                      }
                      className="md:col-span-2 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold"
                      placeholder="CP-01"
                    />
                    <input
                      type="text"
                      value={cp.description}
                      onChange={(e) =>
                        setTranches((prev) =>
                          prev.map((t, ti) =>
                            ti !== tIdx
                              ? t
                              : {
                                  ...t,
                                  conditionsPrecedent:
                                    t.conditionsPrecedent.map((c, ci) =>
                                      ci === cpIdx
                                        ? { ...c, description: e.target.value }
                                        : c,
                                    ),
                                },
                          ),
                        )
                      }
                      className="md:col-span-7 rounded-lg border border-slate-200 px-2 py-1 text-[11px]"
                      placeholder="Condition precedent description..."
                    />
                    <CustomSelect
                      value={cp.status}
                      onChange={(newStatus) =>
                        setTranches((prev) =>
                          prev.map((t, ti) =>
                            ti !== tIdx
                              ? t
                              : {
                                  ...t,
                                  conditionsPrecedent:
                                    t.conditionsPrecedent.map((c, ci) =>
                                      ci === cpIdx
                                        ? {
                                            ...c,
                                            status: newStatus as
                                              | "PENDING"
                                              | "SATISFIED",
                                          }
                                        : c,
                                    ),
                                },
                          ),
                        )
                      }
                      options={CP_STATUS_OPTIONS}
                      size="sm"
                      className="md:col-span-2"
                    />
                    <div className="md:col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          setTranches((prev) =>
                            prev.map((t, ti) =>
                              ti !== tIdx
                                ? t
                                : {
                                    ...t,
                                    conditionsPrecedent:
                                      t.conditionsPrecedent.filter(
                                        (_, ci) => ci !== cpIdx,
                                      ),
                                  },
                            ),
                          )
                        }
                        className="text-slate-400 hover:text-red-600 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 4: Direct BOQ & WBS Upload / Builder */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-brand-primary text-white text-xs font-bold flex items-center justify-center">
              4
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Bill of Quantities (BOQ) &amp; WBS Upload
              </h2>
              <p className="text-[11px] text-slate-500">
                Upload an .xlsx / .csv BOQ file or define WBS items directly.
                Items run through AI Hold-Point, Opaque Lump-Sum, and Tranche
                mapping immediately upon project creation.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadSampleTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>CSV Template</span>
            </button>

            <input
              ref={boqFileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleSpreadsheetSelected}
            />
            <button
              type="button"
              onClick={() => boqFileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-xs font-semibold text-brand-primary"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload .XLSX / .CSV</span>
            </button>

            <button
              type="button"
              onClick={handleLoadSampleWbs}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>Load Sample WBS</span>
            </button>

            <button
              type="button"
              onClick={handleAddBoqRow}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
            >
              <Plus className="w-3.5 h-3.5 text-brand-primary" />
              <span>Add WBS Row</span>
            </button>
          </div>
        </div>

        {/* Attached Binary Excel Indicator */}
        {spreadsheetBase64 && uploadedFileName && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-5 h-5 text-emerald-700 shrink-0" />
              <div>
                <p className="text-xs font-bold text-emerald-950">
                  Attached BOQ Workbook: {uploadedFileName}
                </p>
                <p className="text-[11px] text-emerald-800">
                  Columns parsed automatically (`WBS`, `Section`,
                  `Description`, `Unit`, `Quantity`, `Rate`, `Amount`,
                  `HoldPoint`) with AI screening on submit.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setUploadedFileName(null);
                setSpreadsheetBase64(null);
              }}
              className="text-xs font-semibold text-red-600 hover:underline shrink-0"
            >
              Remove File
            </button>
          </div>
        )}

        {/* Inline WBS Builder / CSV Preview Table */}
        {boqRows.length > 0 ? (
          <div className="space-y-3">
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-600 uppercase">
                  <tr>
                    <th className="px-3 py-2.5 w-24">WBS Code</th>
                    <th className="px-3 py-2.5 w-44">Bill / Section</th>
                    <th className="px-3 py-2.5">Description &amp; Hold-Point Instruction</th>
                    <th className="px-3 py-2.5 w-20">Unit</th>
                    <th className="px-3 py-2.5 w-24">Qty</th>
                    <th className="px-3 py-2.5 w-28">Rate (₦)</th>
                    <th className="px-3 py-2.5 w-28 text-right">Budget (₦)</th>
                    <th className="px-3 py-2.5 w-24 text-center">Hold-Point</th>
                    <th className="px-2 py-2.5 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {boqRows.map((row) => {
                    const rowCost =
                      (Number(row.totalQuantity) || 0) *
                      (Number(row.rateNgn) || 0);
                    return (
                      <tr key={row.localId} className="hover:bg-slate-50/70 align-top">
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={row.wbsCode}
                            onChange={(e) =>
                              setBoqRows((prev) =>
                                prev.map((r) =>
                                  r.localId === row.localId
                                    ? { ...r, wbsCode: e.target.value }
                                    : r,
                                ),
                              )
                            }
                            className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={row.section}
                            onChange={(e) =>
                              setBoqRows((prev) =>
                                prev.map((r) =>
                                  r.localId === row.localId
                                    ? { ...r, section: e.target.value }
                                    : r,
                                ),
                              )
                            }
                            className="w-full rounded-lg border border-slate-200 px-2 py-1 text-[11px]"
                          />
                        </td>
                        <td className="px-2 py-2 space-y-1.5">
                          <input
                            type="text"
                            value={row.description}
                            placeholder="Work item description..."
                            onChange={(e) =>
                              setBoqRows((prev) =>
                                prev.map((r) =>
                                  r.localId === row.localId
                                    ? { ...r, description: e.target.value }
                                    : r,
                                ),
                              )
                            }
                            className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                          />
                          {row.isHoldPoint && (
                            <input
                              type="text"
                              value={row.holdPointInstruction}
                              placeholder="Mandatory Hold-Point inspection rule..."
                              onChange={(e) =>
                                setBoqRows((prev) =>
                                  prev.map((r) =>
                                    r.localId === row.localId
                                      ? {
                                          ...r,
                                          holdPointInstruction: e.target.value,
                                        }
                                      : r,
                                  ),
                                )
                              }
                              className="w-full rounded-lg border border-amber-200 bg-amber-50/50 px-2 py-1 text-[11px] text-amber-900"
                            />
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={row.unit}
                            onChange={(e) =>
                              setBoqRows((prev) =>
                                prev.map((r) =>
                                  r.localId === row.localId
                                    ? { ...r, unit: e.target.value }
                                    : r,
                                ),
                              )
                            }
                            className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0.01}
                            step="any"
                            value={row.totalQuantity}
                            onChange={(e) =>
                              setBoqRows((prev) =>
                                prev.map((r) =>
                                  r.localId === row.localId
                                    ? { ...r, totalQuantity: e.target.value }
                                    : r,
                                ),
                              )
                            }
                            className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={row.rateNgn}
                            onChange={(e) =>
                              setBoqRows((prev) =>
                                prev.map((r) =>
                                  r.localId === row.localId
                                    ? { ...r, rateNgn: e.target.value }
                                    : r,
                                ),
                              )
                            }
                            className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold text-slate-800 whitespace-nowrap">
                          {formatCompactNaira(rowCost)}
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setBoqRows((prev) =>
                                prev.map((r) =>
                                  r.localId === row.localId
                                    ? { ...r, isHoldPoint: !r.isHoldPoint }
                                    : r,
                                ),
                              )
                            }
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition ${
                              row.isHoldPoint
                                ? "bg-amber-50 text-amber-800 border-amber-300"
                                : "bg-slate-50 text-slate-500 border-slate-200"
                            }`}
                          >
                            {row.isHoldPoint ? "Hold-Point" : "Standard"}
                          </button>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setBoqRows((prev) =>
                                prev.filter((r) => r.localId !== row.localId),
                              )
                            }
                            className="text-slate-400 hover:text-red-600 p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between text-xs text-slate-600 px-1">
              <span>
                {boqRows.length} WBS line item(s) ·{" "}
                {boqRows.filter((r) => r.isHoldPoint).length} mandatory
                Hold-Point(s)
              </span>
              <span className="font-bold text-slate-900">
                Measured BOQ Total: {formatCompactNaira(computedBoqTotalNgn)}
              </span>
            </div>
          </div>
        ) : !spreadsheetBase64 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center space-y-2">
            <FileSpreadsheet className="w-7 h-7 text-slate-400 mx-auto" />
            <p className="text-xs font-semibold text-slate-700">
              No BOQ spreadsheet or WBS line items added yet (Optional)
            </p>
            <p className="text-[11px] text-slate-500 max-w-md mx-auto">
              Upload an `.xlsx` / `.csv` BOQ, load sample WBS rows, or add rows
              manually so field teams can begin logging evidence right away.
            </p>
          </div>
        ) : null}
      </section>

      {/* Bottom Action Footer */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          {boqRows.length > 0 || spreadsheetBase64 ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                Project baseline + BOQ/WBS ingestion will execute sequentially
                and open your BOQ &amp; Join Codes workspace.
              </span>
            </>
          ) : (
            <>
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Creating without BOQ items now; you can upload the BOQ anytime
                from the BOQ &amp; Hold-Points tab.
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => navigate(cancelFallbackPath)}
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isBusy}
            className="px-5 py-2.5 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-bold shadow-sm transition disabled:opacity-50"
          >
            {submittingStage === "CREATING_PROJECT"
              ? "Creating Baseline..."
              : submittingStage === "INGESTING_BOQ"
                ? "Ingesting BOQ & Screening WBS..."
                : boqRows.length > 0 || spreadsheetBase64
                  ? "Create Project & Upload BOQ"
                  : "Create Project Baseline"}
          </button>
        </div>
      </div>
    </form>
  );
}
