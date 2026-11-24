import React from "react";
import { FormsAndFacilitiesTab } from "../../components/forms/FormsAndFacilitiesTab";

/**
 * Redesign R6b (D-R6.25, register "Forms & facilities"): the tenant page `/app/forms`, moved out of
 * Settings. Gate (route): `facilities:manage` or `forms:manage`, as the Settings tab had; each
 * section inside keeps its own permission.
 */
export function FormsFacilitiesPage() {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        The facility catalogue and the form library: facility sub-forms, fixed sections and visit form templates, with a preview against a
        real project.
      </p>
      <FormsAndFacilitiesTab />
    </div>
  );
}
