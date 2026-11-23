import { AlertTriangle, Printer, Square, X } from "lucide-react";
import { Overlay } from "../../../components/common/Overlay";
import type { IpcClaimDto } from "@insite/shared";
import type { ProjectSummaryDto } from "../../../api/types";
import { useAuth } from "../../../lib/auth-context";
import { formatCompactNaira, formatRegistrationCredential } from "../../../lib/formatters";

const CHECKLIST = [
  "Dimensional and level check",
  "Material quality and mill certificate",
  "Geotagged photo set",
  "Independent test sample",
];

/** Printable site-visit itinerary built from the lines flagged by reconciliation. */
export function VisitItineraryModal({
  project,
  ipc,
  holdPointsOn = true,
  onClose,
}: {
  project: ProjectSummaryDto;
  ipc: IpcClaimDto;
  /** False when the project turned hold points off (Phase 7): hold-point flags and instructions are ignored. */
  holdPointsOn?: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const targets = ipc.lineItems.filter((li) => li.visitPlannerFlag || (holdPointsOn && li.missingHoldPointFlag));

  return (
    <Overlay className="flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 bg-brand-navy text-white flex items-center justify-between shrink-0">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-brand-sky bg-brand-sky/10 px-2 py-0.5 rounded border border-brand-sky/20">
              Smart Visit Planner
            </span>
            <h3 className="text-base font-bold text-white mt-0.5">Site visit itinerary: {project.codePrefix}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-lg text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs text-slate-700">
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Project</div>
              <div className="font-bold text-slate-900 mt-0.5">{project.name}</div>
              <div className="text-[11px] text-slate-500">
                {project.stateLocation}
                {project.lgaLocation ? ` (${project.lgaLocation})` : ""}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Prepared by</div>
              <div className="font-bold text-slate-900 mt-0.5">{user?.fullName}</div>
              <div className="text-[11px] text-brand-primary font-medium">
                {formatRegistrationCredential(user?.professionalRegistrationBodyCode, user?.professionalRegistrationNumber)}
              </div>
            </div>
            <div className="pt-2 border-t border-slate-200/60 sm:col-span-2">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Claim under review</div>
              <div className="font-semibold text-slate-800 mt-0.5">
                IPC #{ipc.ipcNumber} ({ipc.tranche.name})
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold text-slate-900 text-xs">Ranked checkpoints</h4>
              <span className="text-[10px] font-semibold text-slate-500">{targets.length} flagged</span>
            </div>
            {targets.length === 0 ? (
              <p className="text-slate-500">No lines are flagged for a site visit.</p>
            ) : (
              <div className="space-y-3">
                {targets.map((li, idx) => (
                  <div key={li.id} className="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-brand-primary text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <div>
                          <div className="font-bold text-slate-900">
                            WBS {li.boqItem.wbsCode}: {li.boqItem.description}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{li.boqItem.section}</div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-slate-900">{formatCompactNaira(li.contractorClaimedNgn)}</div>
                        <div className="text-[10px] text-amber-700 font-semibold">Claimed</div>
                      </div>
                    </div>
                    <div className="bg-amber-50/70 rounded-lg p-2.5 border border-amber-200/60 space-y-1">
                      <div className="font-semibold text-amber-900 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                        {li.visitPlannerReason || "Physical inspection required before release"}
                      </div>
                      {holdPointsOn && li.boqItem.holdPointInstruction && (
                        <div className="text-[11px] text-slate-600">{li.boqItem.holdPointInstruction}</div>
                      )}
                    </div>
                    <div className="pt-1 flex flex-wrap gap-2 text-[10px] text-slate-600">
                      {CHECKLIST.map((c) => (
                        <span key={c} className="inline-flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded font-medium">
                          <Square className="w-3 h-3 text-slate-400" />
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-brand-primary/5 rounded-xl p-3.5 border border-brand-primary/15 text-[11px] text-slate-700 leading-relaxed">
            <strong>Field protocol:</strong> capture evidence inside the project geofence. Captures outside the geofence
            or that fail integrity checks are not counted as support in reconciliation.
          </div>
        </div>

        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition">
            Close
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-bold transition flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" />
            Print itinerary
          </button>
        </div>
      </div>
    </Overlay>
  );
}
