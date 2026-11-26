import React, { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../lib/auth-context";
import { Tabs, TabPanel } from "../../components/common/Tabs";
import { FacilitiesCard } from "../../components/facilities/FacilitiesCard";
import { FacilitySubFormsCard } from "../../components/forms/FacilitySubFormsCard";
import { FormSectionsCard } from "../../components/forms/FormSectionsCard";
import { VisitFormTemplatesCard } from "../../components/forms/VisitFormTemplatesCard";
import { VisitFormPreviewCard } from "../../components/forms/VisitFormPreviewCard";

/**
 * "Forms & facilities": the facility catalogue and the form library (facility sub-forms, fixed
 * sections, visit form templates) with a preview against a real project. Each section keeps its own
 * permission; the whole view needs `facilities:manage` or `forms:manage`.
 *
 * UBEC: it lives in Settings as the tab `?tab=forms` (`/app/forms` redirects there). Its own sections
 * use `?section=`, so they do not clash with the Settings tab; changing section keeps `tab`.
 * (Replaces `components/forms/FormsAndFacilitiesTab`, whose sections used `?tab=`.)
 */

type Section = "facilities" | "subforms" | "sections" | "templates" | "preview";

const SECTION_PARAM = "section";
const TAB_PREFIX = "forms-library";

/** The open section from `?section=`; unknown or hidden falls back to the first visible one. */
function useSectionParam(visible: readonly Section[]): [Section | null, (id: Section) => void] {
  const [params, setParams] = useSearchParams();
  const requested = params.get(SECTION_PARAM) as Section | null;
  const active = requested && visible.includes(requested) ? requested : (visible[0] ?? null);
  const setActive = useCallback(
    (id: Section) => {
      setParams(
        (prev) => {
          // Keep the outer tab; drop parameters that belonged to the previous section.
          const next = new URLSearchParams();
          const tab = prev.get("tab");
          if (tab) next.set("tab", tab);
          next.set(SECTION_PARAM, id);
          return next;
        },
        { replace: true }
      );
    },
    [setParams]
  );
  return [active, setActive];
}

export function FormsFacilitiesSettings() {
  const { hasPermission } = useAuth();
  const canFacilities = hasPermission("facilities:manage");
  const canForms = hasPermission("forms:manage");
  const sections: Array<{ id: Section; label: string; show: boolean }> = [
    { id: "facilities", label: "Facilities", show: canFacilities },
    { id: "subforms", label: "Facility sub-forms", show: canForms },
    { id: "sections", label: "Fixed sections", show: canForms },
    { id: "templates", label: "Monitoring form templates", show: canForms },
    { id: "preview", label: "Preview", show: canForms },
  ];
  const visible = sections.filter((s) => s.show);
  const [active, setActive] = useSectionParam(visible.map((s) => s.id));

  if (!active) {
    return <p className="text-xs text-slate-500">You do not have access to the facility catalogue or the form library.</p>;
  }

  const body = (
    <>
      {active === "facilities" && <FacilitiesCard />}
      {active === "subforms" && <FacilitySubFormsCard />}
      {active === "sections" && <FormSectionsCard />}
      {active === "templates" && <VisitFormTemplatesCard />}
      {active === "preview" && <VisitFormPreviewCard />}
    </>
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        The facilities a project can include, and the forms officers fill in on a monitoring visit. Preview a form against a real project.
      </p>
      {visible.length === 1 ? (
        body
      ) : (
        <>
          <Tabs tabs={visible} active={active} onChange={setActive} label="Forms and facilities" idPrefix={TAB_PREFIX} />
          <TabPanel idPrefix={TAB_PREFIX} id={active}>
            {body}
          </TabPanel>
        </>
      )}
    </div>
  );
}

/** Stand-alone page, kept until `/app/forms` redirects to Settings. */
export function FormsFacilitiesPage() {
  return <FormsFacilitiesSettings />;
}
