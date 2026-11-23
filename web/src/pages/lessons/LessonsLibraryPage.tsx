import React, { useState } from "react";
import { Lightbulb, Search } from "lucide-react";
import { LESSON_CATEGORY_META, LessonCategoryEnum } from "@insite/shared";
import Loader from "../../components/Loader";
import { CustomSelect } from "../../components/common";
import { inputClass } from "../../components/common/ModalShell";
import { LessonCard } from "../../components/closure/LessonsPanel";
import { useLessonLibraryQuery } from "../../queries/closure/useClosureQueries";
import { useProjectTypesQuery, useRegionsQuery } from "../../queries/deliveryModels/useDeliveryModelQueries";

const ALL = "";

/**
 * Phase 15: the tenant's lessons-learned library. Published lessons from every project, filtered
 * by project type, region (with its areas), category and tag, with a text search.
 */
export function LessonsLibraryPage() {
  const [projectTypeId, setProjectTypeId] = useState(ALL);
  const [regionId, setRegionId] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [tag, setTag] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const types = useProjectTypesQuery(true);
  const regions = useRegionsQuery();
  const query = useLessonLibraryQuery({ projectTypeId, regionId, category, tag: tag.trim(), q: search });
  const topRegions = (regions.data ?? []).filter((r) => !r.parentRegionId);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Lightbulb className="mt-1 h-5 w-5 text-brand-primary" />
        <div>
          <h1 className="text-lg font-bold text-slate-900">Lessons learned</h1>
          <p className="text-xs text-slate-500">Published lessons from every project, to plan the next ones better.</p>
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <CustomSelect
          value={projectTypeId}
          onChange={setProjectTypeId}
          options={[{ value: ALL, label: "All project types" }, ...(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))]}
        />
        <CustomSelect value={regionId} onChange={setRegionId} options={[{ value: ALL, label: "All regions" }, ...topRegions.map((r) => ({ value: r.id, label: r.name }))]} />
        <CustomSelect
          value={category}
          onChange={setCategory}
          options={[{ value: ALL, label: "All categories" }, ...LessonCategoryEnum.options.map((c) => ({ value: c, label: LESSON_CATEGORY_META[c].label }))]}
        />
        <input value={tag} onChange={(e) => setTag(e.target.value)} className={inputClass} placeholder="Tag, e.g. wash" />
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
          }}
        >
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setSearch(q.trim())} className={`${inputClass} pl-8`} placeholder="Search and press Enter" />
        </form>
      </div>

      {query.isLoading && <Loader />}
      {query.data?.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">No published lessons match.</div>
      )}
      <div className="space-y-3">
        {query.data?.map((lesson) => (
          <LessonCard key={lesson.id} lesson={lesson} showProject />
        ))}
      </div>
    </div>
  );
}
