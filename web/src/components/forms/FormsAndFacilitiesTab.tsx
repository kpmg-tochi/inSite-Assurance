import React, { useState } from "react";
import { useAuth } from "../../lib/auth-context";
import { FacilitiesCard } from "../facilities/FacilitiesCard";
import { FacilitySubFormsCard } from "./FacilitySubFormsCard";
import { FormSectionsCard } from "./FormSectionsCard";
import { VisitFormTemplatesCard } from "./VisitFormTemplatesCard";
import { VisitFormPreviewCard } from "./VisitFormPreviewCard";

/**
 * Redesign R3 (D-R3.22): Settings → "Forms & facilities": the facility catalogue and the form library
 * (facility sub-forms, fixed sections, visit form templates) with a preview against a real project.
 * R6 moves it to the tenant navigation entry /app/forms.
 */

type Section = "FACILITIES" | "SUBFORMS" | "SECTIONS" | "TEMPLATES" | "PREVIEW";

export function FormsAndFacilitiesTab() {
  const { hasPermission } = useAuth();
  const canFacilities = hasPermission("facilities:manage");
  const canForms = hasPermission("forms:manage");
  const sections: Array<{ id: Section; label: string; show: boolean }> = [
    { id: "FACILITIES", label: "Facilities", show: canFacilities },
    { id: "SUBFORMS", label: "Facility sub-forms", show: canForms },
    { id: "SECTIONS", label: "Fixed sections", show: canForms },
    { id: "TEMPLATES", label: "Visit form templates", show: canForms },
    { id: "PREVIEW", label: "Preview", show: canForms },
  ];
  const visible = sections.filter((s) => s.show);
  const [active, setActive] = useState<Section>(visible[0]?.id ?? "FACILITIES");

  return (
    <div className="space-y-4">
      {visible.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {visible.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                active === s.id ? "bg-brand-primary text-white" : "bg-white border border-slate-200 text-slate-600 hover:text-slate-900"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {active === "FACILITIES" && canFacilities && <FacilitiesCard />}
      {active === "SUBFORMS" && canForms && <FacilitySubFormsCard />}
      {active === "SECTIONS" && canForms && <FormSectionsCard />}
      {active === "TEMPLATES" && canForms && <VisitFormTemplatesCard />}
      {active === "PREVIEW" && canForms && <VisitFormPreviewCard />}
    </div>
  );
}
