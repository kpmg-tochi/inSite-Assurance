import { PauseCircle } from "lucide-react";
import type { ProjectPaymentHoldDto } from "@insite/shared";
import { formatDateShort } from "../../lib/formatters";

/**
 * Client demo updates F.4: a payment hold in effect on the project's contractor, shown to everyone
 * on the payments page. A payment recorded during it needs an override reason and is flagged.
 */
export function PaymentHoldBanner({ hold, contractorLabel = "contractor" }: { hold: ProjectPaymentHoldDto; contractorLabel?: string }) {
  return (
    <div role="status" className="flex items-start gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
      <div className="space-y-0.5">
        <p className="font-semibold">
          Payment hold on the {contractorLabel} since {formatDateShort(hold.since)}: {hold.reason}
        </p>
        <p className="text-[11px] text-amber-800">
          Decided by {hold.decidedByName} on a performance flag. A payment recorded during the hold needs an override reason and is flagged as an
          exception.
        </p>
      </div>
    </div>
  );
}
