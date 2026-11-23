import React, { useState } from "react";
import { Lightbulb, Plus } from "lucide-react";
import {
  LESSON_CATEGORY_META,
  LESSON_STAGE_META,
  LessonCategoryEnum,
  LessonStageEnum,
  type LessonCategory,
  type LessonDto,
  type LessonStage,
} from "@insite/shared";
import Loader from "../Loader";
import { CustomSelect } from "../common";
import { useAuth } from "../../lib/auth-context";
import { ModalActions, ModalShell, inputClass } from "../common/ModalShell";
import { StatusChip } from "../contracts/contractUi";
import { useProjectLessonsQuery } from "../../queries/closure/useClosureQueries";
import { usePublishLessonMutation, useSaveLessonMutation } from "../../mutations/closure/useClosureMutations";

/** One lesson (project tab and tenant library). */
export function LessonCard({ lesson, showProject = false, actions }: { lesson: LessonDto; showProject?: boolean; actions?: React.ReactNode }) {
  return (
    <article className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-bold text-slate-900">{lesson.title}</h3>
            {lesson.status === "DRAFT" ? (
              <StatusChip label="Draft" cls="bg-slate-100 text-slate-700 border-slate-200" />
            ) : (
              <StatusChip label="Published" cls="bg-emerald-50 text-emerald-800 border-emerald-200" />
            )}
            {lesson.sharedWithContractor && <StatusChip label="Shared with contractor" cls="bg-sky-50 text-sky-800 border-sky-200" />}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {LESSON_CATEGORY_META[lesson.category].label} · {LESSON_STAGE_META[lesson.stage].label}
            {showProject ? ` · ${lesson.projectCode} ${lesson.projectName}` : ""}
            {showProject && lesson.projectTypeName ? ` · ${lesson.projectTypeName}` : ""}
            {showProject && lesson.regionName ? ` · ${lesson.regionName}` : ""}
            {lesson.createdByName ? ` · ${lesson.createdByName}` : ""}
          </div>
        </div>
        {actions}
      </div>
      <p className="mt-2 whitespace-pre-line text-xs text-slate-700">{lesson.description}</p>
      <p className="mt-1.5 whitespace-pre-line text-xs text-slate-900">
        <span className="font-semibold">Next time: </span>
        {lesson.recommendation}
      </p>
      {lesson.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {lesson.tags.map((t) => (
            <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
              #{t}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

/** Phase 15: lessons learned on the project's Closure tab. */
export function LessonsPanel({ projectId, defaultStage }: { projectId: string; defaultStage: LessonStage }) {
  const { hasPermission } = useAuth();
  const query = useProjectLessonsQuery(projectId);
  const publish = usePublishLessonMutation(projectId);
  const [editing, setEditing] = useState<LessonDto | "new" | null>(null);
  const canManage = hasPermission("lessons:manage");
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Lightbulb className="mt-0.5 h-4 w-4 text-brand-primary" />
          <div>
            <h2 className="text-sm font-bold text-slate-900">Lessons learned</h2>
            <p className="text-[11px] text-slate-500">Drafts stay with the project team. Published lessons join the tenant library.</p>
          </div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1 rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover"
          >
            <Plus className="h-3.5 w-3.5" /> New lesson
          </button>
        )}
      </div>
      {query.isLoading && <Loader />}
      {query.data?.length === 0 && <p className="text-xs text-slate-500">No lessons yet.</p>}
      {query.data?.map((lesson) => (
        <LessonCard
          key={lesson.id}
          lesson={lesson}
          actions={
            lesson.canEdit && (
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditing(lesson)} className="rounded-xl border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                  Edit
                </button>
                {lesson.status === "DRAFT" && (
                  <button
                    type="button"
                    disabled={publish.isPending}
                    onClick={() => publish.mutate(lesson.id)}
                    className="rounded-xl bg-brand-primary px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
                  >
                    Publish
                  </button>
                )}
              </div>
            )
          }
        />
      ))}
      {editing && <LessonModal projectId={projectId} lesson={editing === "new" ? null : editing} defaultStage={defaultStage} onClose={() => setEditing(null)} />}
    </section>
  );
}

function LessonModal({ projectId, lesson, defaultStage, onClose }: { projectId: string; lesson: LessonDto | null; defaultStage: LessonStage; onClose: () => void }) {
  const save = useSaveLessonMutation(projectId);
  const [category, setCategory] = useState<LessonCategory>(lesson?.category ?? "SITE_DELIVERY");
  const [stage, setStage] = useState<LessonStage>(lesson?.stage ?? defaultStage);
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [description, setDescription] = useState(lesson?.description ?? "");
  const [recommendation, setRecommendation] = useState(lesson?.recommendation ?? "");
  const [tags, setTags] = useState((lesson?.tags ?? []).join(", "));
  const [shared, setShared] = useState(lesson?.sharedWithContractor ?? false);
  return (
    <ModalShell title={lesson ? "Edit lesson" : "New lesson"} onClose={onClose} maxWidth="max-w-2xl">
      <form
        className="space-y-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(
            {
              lessonId: lesson?.id,
              body: {
                category,
                stage,
                title: title.trim(),
                description: description.trim(),
                recommendation: recommendation.trim(),
                tags: tags
                  .split(",")
                  .map((t) => t.trim().toLowerCase())
                  .filter(Boolean),
                sharedWithContractor: shared,
              },
            },
            { onSuccess: onClose }
          );
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[11px] font-semibold text-slate-600">
            Category
            <CustomSelect
              value={category}
              onChange={(v) => setCategory(v as LessonCategory)}
              options={LessonCategoryEnum.options.map((o) => ({ value: o, label: LESSON_CATEGORY_META[o].label }))}
            />
          </label>
          <label className="block text-[11px] font-semibold text-slate-600">
            Stage
            <CustomSelect value={stage} onChange={(v) => setStage(v as LessonStage)} options={LessonStageEnum.options.map((o) => ({ value: o, label: LESSON_STAGE_META[o].label }))} />
          </label>
        </div>
        <label className="block text-[11px] font-semibold text-slate-600">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${inputClass} mt-1`} minLength={5} maxLength={200} required />
        </label>
        <label className="block text-[11px] font-semibold text-slate-600">
          What happened
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={`${inputClass} mt-1`} minLength={20} maxLength={4000} required />
        </label>
        <label className="block text-[11px] font-semibold text-slate-600">
          What to do next time
          <textarea value={recommendation} onChange={(e) => setRecommendation(e.target.value)} rows={3} className={`${inputClass} mt-1`} minLength={10} maxLength={4000} required />
        </label>
        <label className="block text-[11px] font-semibold text-slate-600">
          Tags (comma separated)
          <input value={tags} onChange={(e) => setTags(e.target.value)} className={`${inputClass} mt-1`} placeholder="e.g. wash, procurement" />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          Share with the contractor once published (they are notified)
        </label>
        <ModalActions onCancel={onClose} submitLabel={lesson ? "Save" : "Save draft"} pendingLabel="Saving…" isPending={save.isPending} />
      </form>
    </ModalShell>
  );
}
