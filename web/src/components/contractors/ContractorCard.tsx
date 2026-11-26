import React from "react";
import { Link } from "react-router-dom";
import { HardHat } from "lucide-react";
import type { ContractorSummaryDto } from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { ContractorStars, ContractorStatusChip } from "./ContractorStars";

/**
 * Client demo updates F.1: a compact contractor card (name, RC number, status, stars). Links to the
 * register entry for holders of `contractors:view_register`.
 */
export function ContractorCard({ contractor, note }: { contractor: ContractorSummaryDto; note?: React.ReactNode }) {
  const { hasPermission } = useAuth();
  const name = hasPermission("contractors:view_register") ? (
    <Link to={`/app/contractors/${contractor.id}`} className="font-semibold text-slate-900 hover:text-brand-primary hover:underline">
      {contractor.name}
    </Link>
  ) : (
    <span className="font-semibold text-slate-900">{contractor.name}</span>
  );
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs">
      <HardHat className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {name}
          <ContractorStatusChip status={contractor.status} />
        </div>
        <div className="text-[11px] text-slate-500">{contractor.registrationNumber ?? "No RC number recorded"}</div>
        <ContractorStars rating={contractor.rating} />
        {note}
      </div>
    </div>
  );
}
