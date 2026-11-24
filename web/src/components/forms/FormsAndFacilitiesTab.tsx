import React from "react";
import { useAuth } from "../../lib/auth-context";
import { Tabs, TabPanel, useUrlTab } from "../common/Tabs";
import { FacilitiesCard } from "../facilities/FacilitiesCard";
import { FacilitySubFormsCard } from "./FacilitySubFormsCard";
import { FormSectionsCard } from "./FormSectionsCard";
import { VisitFormTemplatesCard } from "./VisitFormTemplatesCard";
import { VisitFormPreviewCard } from "./VisitFormPreviewCard";

/**
 * Redesign R3 (D-R3.22): Settings → "Forms & facilities": the facility catalogue and the form library
 * (facility sub-forms, fixed sections, visit form templates) with a preview against a real project.
 * R6 moves it to the tenant navigation entry /app/forms; its sections are accessible tabs with the
 * open one in the URL (`?tab=`).
 */

type Section = "facilities" | "subforms" | "sections" | "templates" | "preview";

const TAB_PREFIX = "forms-library";

export function FormsAndFacilitiesTab() {
  const { hasPermission } = useAuth();
  const canFacilities = hasPermission("facilities:manage");
  const canForms = hasPermission("forms:manage");
  const sections: Array<{ id: Section; label: string; show: boolean }> = [
    { id: "facilities", label: "Facilities", show: canFacilities },
    { id: "subforms", label: "Facility sub-forms", show: canForms },
    { id: "sections", label: "Fixed sections", show: canForms },
    { id: "templates", label: "Visit form templates", show: canForms },
    { id: "preview", label: "Preview", show: canForms },
  ];
  const visible = sections.filter((s) => s.show);
  const [active, setActive] = useUrlTab<Section>(visible.map((s) => s.id));
  if (!active) return null;

  const body = (
    <>
      {active === "facilities" && <FacilitiesCard />}
      {active === "subforms" && <FacilitySubFormsCard />}
      {active === "sections" && <FormSectionsCard />}
      {active === "templates" && <VisitFormTemplatesCard />}
      {active === "preview" && <VisitFormPreviewCard />}
    </>
  );

  if (visible.length === 1) return body;
  return (
    <div className="space-y-4">
      <Tabs tabs={visible} active={active} onChange={setActive} label="Forms and facilities" idPrefix={TAB_PREFIX} />
      <TabPanel idPrefix={TAB_PREFIX} id={active}>
        {body}
      </TabPanel>
    </div>
  );
}
