import { credentialFieldRules } from "@insite/shared";
import { useCredentialSettingsQuery } from "../../queries/credentials/useCredentialQueries";

/**
 * Phase 12: professional registration on a user form (create and edit). Shown unless the tenant
 * hides registration for every subject. The body list is the tenant's; an archived body already on
 * the profile stays selectable so saving does not drop it.
 */
export function RegistrationFields(props: {
  bodyCode: string;
  onBodyCode: (code: string) => void;
  number: string;
  onNumber: (value: string) => void;
}) {
  const { data: settings } = useCredentialSettingsQuery();
  if (!settings || !settings.profileFieldVisible) return null;
  const rules = credentialFieldRules(settings.resolved.certifier, "certifier");
  const bodies = settings.registrationBodies.filter((b) => !b.isArchived || b.code === props.bodyCode);
  const selected = bodies.find((b) => b.code === props.bodyCode);
  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2.5">
      <div className="font-semibold text-slate-800">Professional registration</div>
      <p className="text-[11px] text-slate-500">
        {settings.resolved.certifier === "REQUIRED"
          ? "Certifiers in this workspace need a registration to certify or verify."
          : settings.resolved.certifier === "OPTIONAL"
            ? "Optional for certifiers in this workspace; printed on certificates when given."
            : "Not used for certifiers in this workspace (a project type may still ask for it)."}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Registration body</label>
          <select
            value={props.bodyCode}
            onChange={(e) => props.onBodyCode(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2"
          >
            <option value="">None</option>
            {bodies.map((b) => (
              <option key={b.code} value={b.code}>
                {b.code}: {b.fullName}
                {b.isArchived ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">{rules.visible ? "Registration number" : "Registration number (not used)"}</label>
          <input
            type="text"
            maxLength={64}
            value={props.number}
            onChange={(e) => props.onNumber(e.target.value)}
            placeholder={selected?.exampleNumber ?? ""}
            className="w-full rounded-xl border border-slate-200 px-3 py-2"
          />
        </div>
      </div>
      {props.number.trim() && !props.bodyCode && (
        <p className="text-[11px] text-amber-700">Choose the body that issued this number.</p>
      )}
    </div>
  );
}
