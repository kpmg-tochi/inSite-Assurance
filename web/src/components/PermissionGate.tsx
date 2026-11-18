import React from "react";
import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { SYSTEM_PERMISSIONS_CATALOG } from "@insite/shared";
import { useAuth } from "../lib/auth-context";

function permissionLabel(key: string): string {
  return SYSTEM_PERMISSIONS_CATALOG.find((p) => p.key === key)?.name ?? key;
}

export function PermissionDenied({
  anyOf,
  backTo = "/app",
}: {
  anyOf: string[];
  backTo?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-8 flex flex-col items-center text-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
        <ShieldAlert className="w-5 h-5" />
      </div>
      <h2 className="text-sm font-bold text-slate-900">You don't have access to this page</h2>
      <p className="text-xs text-slate-500 max-w-md">
        Your role does not include{" "}
        {anyOf.length === 1 ? "the permission" : "any of the permissions"}{" "}
        <strong className="text-slate-700">{anyOf.map(permissionLabel).join(", ")}</strong>.
        Ask a tenant administrator to change your role if you need it.
      </p>
      <Link
        to={backTo}
        className="mt-1 px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50"
      >
        Back to workspace
      </Link>
    </div>
  );
}

/** Renders children only when the user holds at least one of `anyOf`; otherwise explains why. */
export function RequirePermission({
  anyOf,
  backTo,
  children,
}: {
  anyOf: string[];
  backTo?: string;
  children: React.ReactNode;
}) {
  const { hasAnyPermission } = useAuth();
  if (!hasAnyPermission(...anyOf)) {
    return <PermissionDenied anyOf={anyOf} backTo={backTo} />;
  }
  return <>{children}</>;
}
