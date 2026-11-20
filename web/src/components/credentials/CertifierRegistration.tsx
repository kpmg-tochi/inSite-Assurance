import { Link } from "react-router-dom";
import { credentialFieldRules, type CredentialRequirement } from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { formatRegistrationCredential } from "../../lib/formatters";
import { useProjectCredentialPolicyQuery } from "../../queries/credentials/useCredentialQueries";

/**
 * Phase 12: what a certifier's registration means on this project. The project's policy (project
 * type → tenant → REQUIRED) decides whether the registration is shown, optional or needed; the
 * server enforces the same rule, so this only explains it.
 */
export function useCertifierRegistration(projectId: string | undefined) {
  const { user } = useAuth();
  const policy = useProjectCredentialPolicyQuery(projectId);
  // Until the policy loads, assume the strictest setting (today's behaviour) so nothing is promised.
  const requirement: CredentialRequirement = policy.data?.certifier.requirement ?? "REQUIRED";
  const rules = credentialFieldRules(requirement, "certifier");
  const registration = formatRegistrationCredential(user?.professionalRegistrationBodyCode, user?.professionalRegistrationNumber);
  const blocked = rules.required && !registration;
  return { requirement, rules, registration: rules.visible ? registration : null, blocked, loading: policy.isLoading };
}

/** The "Certifier (from your profile)" box used by every certification form. */
export function CertifierRegistrationBox({ projectId, verb = "certify" }: { projectId: string; verb?: string }) {
  const { user } = useAuth();
  const { rules, registration, blocked } = useCertifierRegistration(projectId);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Certifier (from your profile)</div>
      <div className="font-semibold text-slate-900 mt-0.5">{user?.fullName}</div>
      {rules.visible && registration && <div className="text-brand-primary font-medium">{registration}</div>}
      {rules.visible && !registration && !blocked && (
        <div className="text-slate-500 mt-1">No professional registration on your profile. It is optional on this project.</div>
      )}
      {blocked && (
        <div className="text-rose-700 font-medium mt-1">
          This project needs a professional registration to {verb}, and your profile has none. Ask a user administrator to add your
          registration body and number in <Link to="/app/settings" className="underline">Settings</Link>.
        </div>
      )}
    </div>
  );
}

/** Ending of the signature statement: mentions the registration only when one is shown. */
export function signatureRegistrationSuffix(registration: string | null): string {
  return registration ? " with the professional registration shown above" : "";
}
