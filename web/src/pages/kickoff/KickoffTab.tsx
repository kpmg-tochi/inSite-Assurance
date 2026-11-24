import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Mail, Plus, Trash2, Users, XCircle } from "lucide-react";
import {
  KICKOFF_STAKEHOLDER_GROUP_META,
  KickoffStakeholderGroupEnum,
  kickoffQuorumMet,
  type KickoffInviteeInput,
  type KickoffMeetingDto,
  type KickoffStakeholderGroup,
  type ContractMilestoneDto,
  type ProjectKickoffDto,
  type ProjectMilestonesDto,
} from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import { formatDateTimeShort } from "../../lib/formatters";
import { apiErrorCode } from "../../api/process/processApi";
import { useKickoffQuery, useMilestonesQuery } from "../../queries/contracts/useContractQueries";
import {
  useOpenDocumentMutation,
  useRecordKickoffHeldMutation,
  useSaveKickoffMutation,
  useSendKickoffNoticeMutation,
} from "../../mutations/contracts/useContractMutations";
import Loader from "../../components/Loader";
import { DocumentPicker } from "../../components/documents/DocumentPicker";
import { NOTICE_STATUS_META, primaryButton, secondaryButton, sectionClass, smallInput, StatusChip } from "../../components/contracts/contractUi";

/**
 * Phase 13: the kick-off meeting record: invitees by stakeholder group, the notice (one email per
 * invitee), attendance with quorum per required group, and the minutes document.
 */

interface InviteeRow extends KickoffInviteeInput {
  key: string;
}

let seq = 0;
const nextKey = () => `inv-${++seq}`;

/** ISO date-time to the value of a datetime-local input (browser zone). */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : "");

/**
 * Kick-off & mobilisation → Kick-off (redesign R6b, D-R6.15): the guided sequence (contract award and
 * acceptance → notice → meeting held and minutes), then the meeting record.
 */
export function KickoffTab({ project }: { project: ProjectSummaryDto }) {
  const q = useKickoffQuery(project.id);
  const milestones = useMilestonesQuery(project.id);
  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500">Invitees by stakeholder group, the notice, attendance and quorum, and the signed minutes.</p>
      {q.isLoading ? (
        <Loader />
      ) : q.isError || !q.data ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
          Could not load the kick-off meeting. {(q.error as Error | null)?.message}
        </div>
      ) : (
        <>
          <KickoffSequence k={q.data} milestones={milestones.data ?? null} />
          <KickoffBody projectId={project.id} k={q.data} />
        </>
      )}
    </div>
  );
}

type SequenceState = "DONE" | "CURRENT" | "UPCOMING";
const SEQUENCE_STATE_TEXT: Record<SequenceState, string> = { DONE: "Done", CURRENT: "Next", UPCOMING: "Later" };

/** The acceptance-letter milestone: by its key, or by the document it needs. */
function acceptanceMilestone(m: ProjectMilestonesDto | null): ContractMilestoneDto | null {
  return m?.milestones.find((x) => x.key === "acceptance-letter" || x.requiredDocumentTypeCodes.includes("ACCEPTANCE_LETTER")) ?? null;
}

function KickoffSequence({ k, milestones }: { k: ProjectKickoffDto; milestones: ProjectMilestonesDto | null }) {
  const meeting = k.meeting;
  const acceptance = acceptanceMilestone(milestones);
  const awardDate = milestones?.anchors.contractAwardDate ?? null;
  const acceptanceDone = !acceptance || acceptance.status === "DONE" || acceptance.status === "WAIVED";
  const steps: Array<{ key: string; title: string; done: boolean; detail: string }> = [
    {
      key: "award",
      title: "Contract award and acceptance",
      done: Boolean(awardDate) && acceptanceDone,
      detail: [
        awardDate ? `Awarded ${awardDate}` : "Award date not recorded (project settings, Contract step)",
        acceptance
          ? acceptance.status === "DONE"
            ? "acceptance letter received"
            : acceptance.status === "WAIVED"
              ? "acceptance letter waived"
              : `acceptance letter ${acceptance.dueDate ? `due ${acceptance.dueDate}` : "not dated yet"}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
    {
      key: "notice",
      title: "Kick-off notice",
      done: Boolean(meeting?.noticeSentAt || meeting?.heldAt),
      detail: meeting?.noticeSentAt
        ? `Sent ${formatDateTimeShort(meeting.noticeSentAt)}`
        : meeting
          ? `Meeting scheduled ${formatDateTimeShort(meeting.scheduledAt)}; notice not sent`
          : `Schedule the meeting${k.plannedKickoffDate ? ` (planned ${k.plannedKickoffDate})` : ""}, then send the notice`,
    },
    {
      key: "held",
      title: "Meeting held and minutes",
      done: Boolean(meeting?.heldAt && meeting.minutesDocumentId),
      detail: meeting?.heldAt
        ? `Held ${formatDateTimeShort(meeting.heldAt)}${meeting.minutesDocumentId ? " · minutes attached" : " · minutes not attached"}`
        : "Record the meeting as held with attendance and the minutes",
    },
  ];
  const firstOpen = steps.findIndex((s) => !s.done);
  return (
    <ol aria-label="Kick-off sequence" className="grid grid-cols-1 md:grid-cols-3 gap-2">
      {steps.map((s, i) => {
        const state: SequenceState = s.done ? "DONE" : i === firstOpen ? "CURRENT" : "UPCOMING";
        return (
          <li
            key={s.key}
            aria-current={state === "CURRENT" ? "step" : undefined}
            className={`rounded-xl border px-3 py-2.5 text-xs ${
              state === "DONE" ? "border-emerald-200 bg-emerald-50/60" : state === "CURRENT" ? "border-brand-primary/40 bg-brand-primary/5" : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-900">
                {i + 1}. {s.title}
              </span>
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${state === "DONE" ? "text-emerald-700" : state === "CURRENT" ? "text-brand-primary" : "text-slate-500"}`}>
                {state === "DONE" && <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />}
                {SEQUENCE_STATE_TEXT[state]}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-600">{s.detail}</p>
          </li>
        );
      })}
    </ol>
  );
}

function KickoffBody({ projectId, k }: { projectId: string; k: ProjectKickoffDto }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("kickoff:manage");
  const meeting = k.meeting;
  const held = Boolean(meeting?.heldAt);

  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700 flex flex-wrap gap-x-6 gap-y-1">
        <span>
          Planned kick-off: <span className="font-semibold">{k.plannedKickoffDate ?? "not set"}</span>
        </span>
        <span>Notice at least {k.noticeLeadDays} day(s) before</span>
        <span>
          Quorum:{" "}
          {k.requiredStakeholderGroups.length === 0
            ? "no rule"
            : `one attendee from each of ${k.requiredStakeholderGroups.map((g) => KICKOFF_STAKEHOLDER_GROUP_META[g].label.toLowerCase()).join(", ")}`}
        </span>
      </div>

      {held && meeting ? (
        <HeldSummary projectId={projectId} meeting={meeting} />
      ) : (
        <MeetingForm projectId={projectId} k={k} canManage={canManage} />
      )}
      {meeting && !held && <NoticeSection projectId={projectId} meeting={meeting} canManage={canManage} />}
      {meeting && !held && canManage && <RecordHeldSection projectId={projectId} k={k} meeting={meeting} />}
    </>
  );
}

function MeetingForm({ projectId, k, canManage }: { projectId: string; k: ProjectKickoffDto; canManage: boolean }) {
  const save = useSaveKickoffMutation(projectId);
  const m = k.meeting;
  const initial = useMemo(
    () => ({
      scheduledAt: m ? toLocalInput(m.scheduledAt) : k.plannedKickoffDate ? `${k.plannedKickoffDate}T10:00` : "",
      location: m?.location ?? "",
      virtualLink: m?.virtualLink ?? "",
      agendaDocumentId: m?.agendaDocumentId ?? null,
      agendaTitle: m?.agendaDocumentTitle ?? null,
      invitees: (m
        ? m.invitees.map<KickoffInviteeInput>((i) => ({
            id: i.id,
            stakeholderGroup: i.stakeholderGroup,
            name: i.name,
            email: i.email,
            phone: i.phone,
            organizationId: i.organizationId,
            userId: i.userId,
          }))
        : k.suggestedInvitees
      ).map<InviteeRow>((i) => ({ ...i, key: nextKey() })),
    }),
    [k, m]
  );
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setState(initial), [initial]);
  const disabled = !canManage || save.isPending;
  const strip = (s: typeof state) => ({ ...s, agendaTitle: null, invitees: s.invitees.map(({ key: _k, ...rest }) => rest) });
  const dirty = JSON.stringify(strip(state)) !== JSON.stringify(strip(initial));

  const setInvitee = (key: string, patch: Partial<InviteeRow>) =>
    setState((s) => ({ ...s, invitees: s.invitees.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));

  const submit = () => {
    if (!state.scheduledAt) return setError("Set the date and time.");
    if (state.invitees.length === 0) return setError("Invite at least one person.");
    const bad = state.invitees.findIndex((i) => i.name.trim().length < 2);
    if (bad >= 0) return setError(`Enter a name for invitee ${bad + 1}.`);
    const badEmail = state.invitees.findIndex((i) => i.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email.trim()));
    if (badEmail >= 0) return setError(`Check the email address of invitee ${badEmail + 1}.`);
    setError(null);
    save.mutate({
      scheduledAt: fromLocalInput(state.scheduledAt),
      location: state.location.trim() || null,
      virtualLink: state.virtualLink.trim() || null,
      agendaDocumentId: state.agendaDocumentId,
      invitees: state.invitees.map(({ key: _k, ...i }) => ({
        ...i,
        name: i.name.trim(),
        email: i.email?.trim() || null,
        phone: i.phone?.trim() || null,
      })),
    });
  };

  return (
    <section className={sectionClass} aria-label="Meeting">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
          <Users className="w-4 h-4 text-brand-primary" /> {m ? "Meeting" : "Schedule the meeting"}
        </h2>
        {!m && <span className="text-[11px] text-slate-500">Invitees are pre-filled from the parties, beneficiaries and team.</span>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="ko-when">
            Date and time
          </label>
          <input id="ko-when" type="datetime-local" className={smallInput} value={state.scheduledAt} onChange={(e) => setState((s) => ({ ...s, scheduledAt: e.target.value }))} disabled={disabled} />
          <p className="mt-1 text-[11px] text-slate-500">In your browser's time zone.</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="ko-where">
            Location
          </label>
          <input id="ko-where" className={smallInput} value={state.location} maxLength={300} onChange={(e) => setState((s) => ({ ...s, location: e.target.value }))} disabled={disabled} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="ko-link">
            Online meeting link (optional)
          </label>
          <input id="ko-link" className={smallInput} value={state.virtualLink} maxLength={500} placeholder="https://" onChange={(e) => setState((s) => ({ ...s, virtualLink: e.target.value }))} disabled={disabled} />
        </div>
      </div>
      <DocumentPicker
        projectId={projectId}
        typeCode="KICKOFF_BRIEFING_PACK"
        label="Briefing pack (sent with the notice)"
        value={state.agendaDocumentId}
        currentTitle={state.agendaTitle}
        onChange={(id, title) => setState((s) => ({ ...s, agendaDocumentId: id, agendaTitle: title }))}
        disabled={disabled}
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-900">Invitees ({state.invitees.length})</h3>
          {canManage && (
            <button
              type="button"
              onClick={() => setState((s) => ({ ...s, invitees: [...s.invitees, { key: nextKey(), stakeholderGroup: "OTHER", name: "", email: null, phone: null }] }))}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-primary hover:underline"
            >
              <Plus className="w-3 h-3" /> Add invitee
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-xs">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">
                <th className="py-2 pr-2 font-semibold w-44">Group</th>
                <th className="py-2 pr-2 font-semibold">Name</th>
                <th className="py-2 pr-2 font-semibold">Email</th>
                <th className="py-2 pr-2 font-semibold w-36">Phone</th>
                <th className="py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {state.invitees.map((i) => (
                <tr key={i.key}>
                  <td className="py-1 pr-2">
                    <select className={smallInput} value={i.stakeholderGroup} onChange={(e) => setInvitee(i.key, { stakeholderGroup: e.target.value as KickoffStakeholderGroup })} disabled={disabled} aria-label="Group">
                      {KickoffStakeholderGroupEnum.options.map((g) => (
                        <option key={g} value={g}>
                          {KICKOFF_STAKEHOLDER_GROUP_META[g].label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input className={smallInput} value={i.name} maxLength={160} onChange={(e) => setInvitee(i.key, { name: e.target.value })} disabled={disabled} aria-label="Name" />
                  </td>
                  <td className="py-1 pr-2">
                    <input className={smallInput} type="email" value={i.email ?? ""} maxLength={200} onChange={(e) => setInvitee(i.key, { email: e.target.value || null })} disabled={disabled} aria-label="Email" />
                  </td>
                  <td className="py-1 pr-2">
                    <input className={smallInput} value={i.phone ?? ""} maxLength={32} onChange={(e) => setInvitee(i.key, { phone: e.target.value || null })} disabled={disabled} aria-label="Phone" />
                  </td>
                  <td className="py-1">
                    {canManage && (
                      <button type="button" onClick={() => setState((s) => ({ ...s, invitees: s.invitees.filter((x) => x.key !== i.key) }))} className="text-rose-600" aria-label="Remove invitee">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
      {canManage && (
        <div className="flex items-center justify-end gap-2">
          {dirty && m && <span className="text-[11px] text-amber-700">Unsaved changes</span>}
          <button type="button" className={primaryButton} disabled={save.isPending || (!dirty && Boolean(m))} onClick={submit}>
            {save.isPending ? "Saving…" : m ? "Save changes" : "Save meeting"}
          </button>
        </div>
      )}
    </section>
  );
}

function NoticeSection({ projectId, meeting, canManage }: { projectId: string; meeting: KickoffMeetingDto; canManage: boolean }) {
  const send = useSendKickoffNoticeMutation(projectId);
  const [waiver, setWaiver] = useState<{ daysLeft: number | null; leadDays: number | null } | null>(null);
  const [reason, setReason] = useState("");

  const sendNotice = async (waiveLeadTimeReason?: string) => {
    try {
      await send.mutateAsync(waiveLeadTimeReason ? { waiveLeadTimeReason } : {});
      setWaiver(null);
      setReason("");
    } catch (err) {
      const { code, details } = apiErrorCode(err);
      if (code === "NOTICE_LEAD_TIME_SHORT") {
        setWaiver({
          daysLeft: typeof details?.daysLeft === "number" ? details.daysLeft : null,
          leadDays: typeof details?.noticeLeadDays === "number" ? details.noticeLeadDays : meeting.noticeLeadDays,
        });
      }
    }
  };

  return (
    <section className={sectionClass} aria-label="Notice">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
          <Mail className="w-4 h-4 text-brand-primary" /> Notice
        </h2>
        {meeting.noticeSentAt ? (
          <span className="text-[11px] text-slate-600">
            Sent {formatDateTimeShort(meeting.noticeSentAt)}
            {meeting.noticeWaivedReason ? ` · short notice accepted: ${meeting.noticeWaivedReason}` : ""}
          </span>
        ) : (
          canManage &&
          !waiver && (
            <button type="button" className={primaryButton} disabled={send.isPending} onClick={() => sendNotice()}>
              {send.isPending ? "Sending…" : "Send notice"}
            </button>
          )
        )}
      </div>
      <p className="text-[11px] text-slate-500">
        One email per invitee with the date, place and briefing pack. The status shows what the mail service accepted; it does not show
        whether anyone opened it.
      </p>
      {waiver && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2 text-xs text-amber-900">
          <p>
            The notice should go out at least {waiver.leadDays ?? meeting.noticeLeadDays} day(s) before the meeting
            {waiver.daysLeft !== null ? `; only ${waiver.daysLeft} day(s) remain` : ""}. To send it anyway, record why.
          </p>
          <input className={smallInput} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Why short notice is acceptable" aria-label="Reason" />
          <div className="flex gap-2">
            <button type="button" className={primaryButton} disabled={send.isPending || reason.trim().length < 5} onClick={() => sendNotice(reason.trim())}>
              Send with short notice
            </button>
            <button type="button" className={secondaryButton} onClick={() => setWaiver(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <ul className="divide-y divide-slate-100">
        {meeting.invitees.map((i) => {
          const st = NOTICE_STATUS_META[i.noticeStatus];
          return (
            <li key={i.id} className="flex items-center justify-between gap-2 py-2 text-xs">
              <span>
                <span className="font-semibold text-slate-900">{i.name}</span>
                <span className="text-slate-500">
                  {" "}
                  · {KICKOFF_STAKEHOLDER_GROUP_META[i.stakeholderGroup].label}
                  {i.organizationName ? ` · ${i.organizationName}` : ""}
                  {i.email ? ` · ${i.email}` : ""}
                </span>
              </span>
              <span className={`shrink-0 text-[11px] font-semibold ${st.cls}`} title={i.noticeSentAt ? formatDateTimeShort(i.noticeSentAt) : undefined}>
                {st.label}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function QuorumList({ required, attendedGroups, invited }: { required: KickoffStakeholderGroup[]; attendedGroups: KickoffStakeholderGroup[]; invited: KickoffStakeholderGroup[] }) {
  if (required.length === 0) return <p className="text-[11px] text-slate-500">No quorum rule for this project.</p>;
  return (
    <ul className="flex flex-wrap gap-2">
      {required.map((g) => {
        const present = attendedGroups.includes(g);
        return (
          <li
            key={g}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold ${present ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}
          >
            {present ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {KICKOFF_STAKEHOLDER_GROUP_META[g].label}
            {!invited.includes(g) ? " (nobody invited)" : ""}
          </li>
        );
      })}
    </ul>
  );
}

function RecordHeldSection({ projectId, k, meeting }: { projectId: string; k: ProjectKickoffDto; meeting: KickoffMeetingDto }) {
  const record = useRecordKickoffHeldMutation(projectId);
  const [open, setOpen] = useState(false);
  const [heldAt, setHeldAt] = useState(toLocalInput(meeting.scheduledAt));
  const [attended, setAttended] = useState<Record<string, boolean>>(() => Object.fromEntries(meeting.invitees.map((i) => [i.id, i.attended ?? false])));
  const [minutesId, setMinutesId] = useState<string | null>(meeting.minutesDocumentId);
  const [minutesTitle, setMinutesTitle] = useState<string | null>(meeting.minutesDocumentTitle);
  const [waiverReason, setWaiverReason] = useState("");
  const [serverMissing, setServerMissing] = useState<string[] | null>(null);
  const [moveAnchor, setMoveAnchor] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const required = meeting.requiredStakeholderGroups.length ? meeting.requiredStakeholderGroups : k.requiredStakeholderGroups;
  const attendedGroups = meeting.invitees.filter((i) => attended[i.id]).map((i) => i.stakeholderGroup);
  const quorumMet = kickoffQuorumMet(required, attendedGroups);
  const heldDate = heldAt.slice(0, 10);
  const dateDiffers = Boolean(k.plannedKickoffDate && heldDate && heldDate !== k.plannedKickoffDate);

  const submit = async () => {
    if (!heldAt) return setError("Set when the meeting was held.");
    if (!quorumMet && waiverReason.trim().length < 5) return setError("Quorum is not met: record why the meeting still counts (at least 5 characters).");
    setError(null);
    try {
      await record.mutateAsync({
        heldAt: fromLocalInput(heldAt),
        attendance: meeting.invitees.map((i) => ({ inviteeId: i.id, attended: Boolean(attended[i.id]) })),
        minutesDocumentId: minutesId,
        ...(!quorumMet || serverMissing ? { quorumWaivedReason: waiverReason.trim() || undefined } : {}),
        moveKickoffAnchor: dateDiffers ? moveAnchor : true,
      });
    } catch (err) {
      const { code, details } = apiErrorCode(err);
      if (code === "QUORUM_NOT_MET") {
        const missing = Array.isArray(details?.missingGroups) ? (details!.missingGroups as string[]) : [];
        setServerMissing(missing);
        setError(
          `Quorum is not met${missing.length ? ` (missing: ${missing.map((g) => KICKOFF_STAKEHOLDER_GROUP_META[g as KickoffStakeholderGroup]?.label ?? g).join(", ")})` : ""}. Record why the meeting still counts.`
        );
      }
    }
  };

  if (!open) {
    return (
      <div className="flex justify-end">
        <button type="button" className={primaryButton} onClick={() => setOpen(true)}>
          Record the meeting as held
        </button>
      </div>
    );
  }

  return (
    <section className={sectionClass} aria-label="Record the meeting">
      <h2 className="text-sm font-bold text-slate-900">Record the meeting as held</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="ko-held">
            Held at
          </label>
          <input id="ko-held" type="datetime-local" className={smallInput} value={heldAt} onChange={(e) => setHeldAt(e.target.value)} />
        </div>
        <DocumentPicker
          projectId={projectId}
          typeCode="KICKOFF_MINUTES"
          label="Minutes"
          hint="Attendees with accounts are asked to sign off the minutes."
          value={minutesId}
          currentTitle={minutesTitle}
          onChange={(id, title) => {
            setMinutesId(id);
            setMinutesTitle(title);
          }}
        />
      </div>
      {dateDiffers && (
        <label className="flex items-start gap-2 rounded-xl border border-brand-primary/25 bg-brand-primary/5 p-3 text-xs text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={moveAnchor} onChange={(e) => setMoveAnchor(e.target.checked)} />
          <span>
            <span className="font-semibold">Move the kick-off date to {heldDate}?</span>
            <span className="block text-[11px] text-slate-500">
              The planned date was {k.plannedKickoffDate}. Pending milestones counted from the kick-off (such as mobilisation) are re-dated from the day it was held.
            </span>
          </span>
        </label>
      )}
      <div className="space-y-1.5">
        <h3 className="text-xs font-bold text-slate-900">Attendance</h3>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {meeting.invitees.map((i) => (
            <li key={i.id}>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700">
                <input type="checkbox" checked={Boolean(attended[i.id])} onChange={(e) => setAttended((a) => ({ ...a, [i.id]: e.target.checked }))} />
                <span className="font-semibold">{i.name}</span>
                <span className="text-slate-500">· {KICKOFF_STAKEHOLDER_GROUP_META[i.stakeholderGroup].label}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-1.5">
        <h3 className="text-xs font-bold text-slate-900">Quorum {quorumMet ? "met" : "not met"}</h3>
        <QuorumList required={required} attendedGroups={attendedGroups} invited={meeting.invitees.map((i) => i.stakeholderGroup)} />
      </div>
      {(!quorumMet || serverMissing) && (
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="ko-waiver">
            Why the meeting counts without quorum
          </label>
          <input id="ko-waiver" className={smallInput} value={waiverReason} maxLength={500} onChange={(e) => setWaiverReason(e.target.value)} />
        </div>
      )}
      {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryButton} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="button" className={primaryButton} disabled={record.isPending} onClick={submit}>
          {record.isPending ? "Saving…" : "Record as held"}
        </button>
      </div>
    </section>
  );
}

function HeldSummary({ projectId, meeting }: { projectId: string; meeting: KickoffMeetingDto }) {
  const open = useOpenDocumentMutation(projectId);
  const attendedGroups = meeting.invitees.filter((i) => i.attended).map((i) => i.stakeholderGroup);
  return (
    <section className={sectionClass} aria-label="Meeting held">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">Held {formatDateTimeShort(meeting.heldAt)}</h2>
        {meeting.quorumMet ? (
          <StatusChip label="Quorum met" cls="bg-emerald-50 text-emerald-800 border-emerald-200" />
        ) : meeting.quorumWaivedReason ? (
          <StatusChip label="Held without quorum" cls="bg-amber-50 text-amber-800 border-amber-200" title={meeting.quorumWaivedReason} />
        ) : null}
      </div>
      <p className="text-[11px] text-slate-500">
        Scheduled {formatDateTimeShort(meeting.scheduledAt)}
        {meeting.location ? ` · ${meeting.location}` : ""}
        {meeting.noticeSentAt ? ` · notice sent ${formatDateTimeShort(meeting.noticeSentAt)}` : " · notice not sent through the platform"}
      </p>
      {meeting.quorumWaivedReason && <p className="text-xs text-amber-800">Without quorum because: {meeting.quorumWaivedReason}</p>}
      <QuorumList required={meeting.requiredStakeholderGroups} attendedGroups={attendedGroups} invited={meeting.invitees.map((i) => i.stakeholderGroup)} />
      <div className="text-xs">
        Minutes:{" "}
        {meeting.minutesDocumentId ? (
          <button type="button" className="font-semibold text-brand-primary hover:underline" onClick={() => open.mutate({ documentId: meeting.minutesDocumentId! })}>
            {meeting.minutesDocumentTitle ?? "Open"}
          </button>
        ) : (
          <span className="text-slate-500">not attached</span>
        )}
        {meeting.minutesDocumentId && (
          <Link to={`/app/projects/${projectId}/documents?documentId=${meeting.minutesDocumentId}`} className="ml-2 text-[11px] text-slate-500 hover:underline">
            Sign-offs
          </Link>
        )}
      </div>
      <ul className="divide-y divide-slate-100">
        {meeting.invitees.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-2 py-2 text-xs">
            <span>
              <span className="font-semibold text-slate-900">{i.name}</span>
              <span className="text-slate-500"> · {KICKOFF_STAKEHOLDER_GROUP_META[i.stakeholderGroup].label}</span>
            </span>
            <span className={`text-[11px] font-semibold ${i.attended ? "text-emerald-700" : "text-slate-400"}`}>{i.attended ? "Attended" : "Absent"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
