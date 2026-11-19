import React, { useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import {
  DEFAULT_REMINDER_OFFSETS_DAYS,
  type ExpectedParticipantDto,
  type MobilizationStatus,
  type ProjectContractorDto,
} from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { useParticipantsQuery } from "../../queries/cadence/useCadenceQueries";
import {
  useCreateParticipantMutation,
  useDeleteParticipantMutation,
  useSaveReminderSettingsMutation,
  useUpdateParticipantMutation,
} from "../../mutations/cadence/useCadenceMutations";
import type { TeamOptions } from "../../api/projects/projectSetupApi";
import { StandardTable, TableActionMenu, TableBadge, type TableBadgeVariant, type TableColumnDef } from "../table";

const STATUS_META: Record<MobilizationStatus, { label: string; variant: TableBadgeVariant }> = {
  INVITED: { label: "Invited", variant: "neutral" },
  REGISTERED_PENDING_ASSURANCE: { label: "Registered · identity pending", variant: "warning" },
  READY_FOR_MOBILIZATION: { label: "Ready", variant: "info" },
  MOBILIZED_ON_SITE: { label: "On site", variant: "success" },
  NO_SHOW_FLAGGED: { label: "No-show", variant: "danger" },
  WITHDRAWN: { label: "Withdrawn", variant: "neutral" },
};

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:bg-slate-50";
const labelCls = "block text-xs font-semibold text-slate-700 mb-1";

function parseOffsets(text: string): number[] | null {
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 90)) return null;
  return [...new Set(nums)].sort((a, b) => b - a);
}

const EMPTY_FORM = {
  roleId: "",
  projectContractorId: "",
  userId: "",
  fullName: "",
  email: "",
  phoneNumber: "",
  plannedMobilizationDate: "",
  expectedCheckInTime: "",
};

/**
 * Expected participants (Phase 8): who is expected on site and when, with reminder schedule.
 * Used by the setup wizard's Team step (draft) and project settings (live).
 */
export function ExpectedParticipantsPanel({
  projectId,
  readOnly,
  options,
  contractors,
  reminderOffsetsDays,
}: {
  projectId: string;
  readOnly: boolean;
  options: TeamOptions | undefined;
  contractors: ProjectContractorDto[];
  reminderOffsetsDays: number[];
}) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("mobilization:manage_roster") && !readOnly;
  const canConfigure = hasPermission("mobilization:configure_reminders") && !readOnly;
  const participants = useParticipantsQuery(projectId, hasPermission("mobilization:manage_roster") || hasPermission("presence:manage_noshow_alerts"));
  const create = useCreateParticipantMutation(projectId);
  const update = useUpdateParticipantMutation(projectId);
  const remove = useDeleteParticipantMutation(projectId);
  const saveReminders = useSaveReminderSettingsMutation(projectId);

  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [offsetsText, setOffsetsText] = useState((reminderOffsetsDays.length ? reminderOffsetsDays : DEFAULT_REMINDER_OFFSETS_DAYS).join(", "));
  const roles = options?.roles ?? [];
  const role = roles.find((r) => r.id === form.roleId);
  const provisioned = role?.onboardingMode === "PROVISIONED_ACCOUNT";
  const linkableUsers = useMemo(() => (options?.users ?? []).filter((u) => Boolean(u.mobileRoleName)), [options]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!form.roleId || !form.fullName.trim() || !form.plannedMobilizationDate) {
      setFormError("Role, name and planned date are required.");
      return;
    }
    if (provisioned && !form.userId) {
      setFormError("This role signs in with an account: pick the person's account.");
      return;
    }
    if (!provisioned && !form.email && !form.phoneNumber) {
      setFormError("Give an email or phone number so reminders can reach them.");
      return;
    }
    try {
      await create.mutateAsync({
        roleId: form.roleId,
        projectContractorId: form.projectContractorId || null,
        userId: provisioned ? form.userId : null,
        fullName: form.fullName.trim(),
        email: form.email.trim() || null,
        phoneNumber: form.phoneNumber.trim() || null,
        plannedMobilizationDate: form.plannedMobilizationDate,
        expectedCheckInTime: form.expectedCheckInTime || null,
      });
      setForm(EMPTY_FORM);
    } catch {
      /* the mutation shows the error */
    }
  };

  const columns: TableColumnDef<ExpectedParticipantDto>[] = [
    {
      id: "name",
      header: "Person",
      cell: (p) => (
        <div className="text-xs">
          <p className="font-semibold text-slate-800">{p.fullName}</p>
          <p className="text-slate-500">
            {p.roleName}
            {p.contractorName ? ` · ${p.contractorName}` : ""}
          </p>
        </div>
      ),
    },
    {
      id: "contact",
      header: "Reaches them by",
      cell: (p) => (
        <span className="text-xs text-slate-600">
          {p.onboardingMode === "PROVISIONED_ACCOUNT" ? "Account (app + email)" : [p.email, p.phoneNumber].filter(Boolean).join(" · ") || "—"}
        </span>
      ),
    },
    {
      id: "planned",
      header: "Expected",
      tooltip: "Planned mobilization date and check-in time (project time zone)",
      cell: (p) => (
        <span className="text-xs font-mono text-slate-700 whitespace-nowrap">
          {p.plannedMobilizationDate} {p.expectedCheckInTime}
        </span>
      ),
    },
    {
      id: "reminders",
      header: "Reminders",
      tooltip: "Days before the planned date",
      cell: (p) => (
        <span className="text-xs text-slate-600 whitespace-nowrap">
          {p.reminderOffsetsDays.length ? `${p.reminderOffsetsDays.join(", ")} d` : "None"}
          {!p.usesProjectReminderSchedule && " (own)"}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (p) => <TableBadge variant={STATUS_META[p.mobilizationStatus].variant}>{STATUS_META[p.mobilizationStatus].label}</TableBadge>,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      width: "w-12",
      cell: (p) =>
        canManage ? (
          <TableActionMenu
            actions={[
              p.mobilizationStatus === "WITHDRAWN"
                ? { label: "Restore", onClick: () => update.mutate({ participantId: p.id, body: { withdrawn: false } }) }
                : { label: "Withdraw", onClick: () => update.mutate({ participantId: p.id, body: { withdrawn: true } }) },
              ...(canConfigure && !p.usesProjectReminderSchedule
                ? [{ label: "Use project reminders", onClick: () => update.mutate({ participantId: p.id, body: { reminderOffsetsDays: null } }) }]
                : []),
              ...(canConfigure && p.usesProjectReminderSchedule
                ? [
                    {
                      label: "No reminders for this person",
                      onClick: () => update.mutate({ participantId: p.id, body: { reminderOffsetsDays: [] } }),
                    },
                  ]
                : []),
              { label: "Remove", variant: "danger" as const, onClick: () => remove.mutate(p.id) },
            ]}
          />
        ) : null,
    },
  ];

  const offsets = parseOffsets(offsetsText);

  return (
    <div className="space-y-4">
      {canConfigure && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={labelCls} htmlFor="reminder-offsets">
              Reminder schedule (days before)
            </label>
            <input id="reminder-offsets" className={`${inputCls} w-48`} value={offsetsText} onChange={(e) => setOffsetsText(e.target.value)} placeholder="7, 3, 1" />
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-50"
            disabled={!offsets || saveReminders.isPending}
            onClick={() => offsets && saveReminders.mutate(offsets)}
          >
            Save schedule
          </button>
          {!offsets && <p className="text-[11px] text-red-600">Use whole days from 0 to 90, separated by commas.</p>}
        </div>
      )}

      <StandardTable
        title="Expected on site"
        subtitle="People who are not ready get reminders before their date. A no-show alert is raised if they do not check in on the day."
        columns={columns}
        data={participants.data ?? []}
        keyExtractor={(p) => p.id}
        loading={participants.isLoading}
        emptyState={{ title: "No one pre-registered", description: "Add the people you expect so reminders and no-show alerts can work." }}
      />

      {canManage && (
        <form onSubmit={submit} className="rounded-xl border border-slate-200 p-4 space-y-3" aria-label="Add an expected participant">
          <p className="flex items-center gap-2 text-xs font-bold text-slate-900">
            <UserPlus className="w-4 h-4" /> Add someone expected on site
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className={labelCls} htmlFor="p-role">Mobile role</label>
              <select id="p-role" className={inputCls} value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value, userId: "" })}>
                <option value="">Choose a role</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} {r.onboardingMode === "PROVISIONED_ACCOUNT" ? "(signs in with account)" : "(join code)"}
                  </option>
                ))}
              </select>
            </div>
            {provisioned ? (
              <div>
                <label className={labelCls} htmlFor="p-user">Account</label>
                <select
                  id="p-user"
                  className={inputCls}
                  value={form.userId}
                  onChange={(e) => {
                    const u = linkableUsers.find((x) => x.id === e.target.value);
                    setForm({ ...form, userId: e.target.value, fullName: u?.fullName ?? form.fullName });
                  }}
                >
                  <option value="">Choose an account</option>
                  {linkableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} · {u.organizationName}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div>
              <label className={labelCls} htmlFor="p-name">Full name</label>
              <input id="p-name" className={inputCls} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </div>
            {!provisioned && (
              <>
                <div>
                  <label className={labelCls} htmlFor="p-email">Email</label>
                  <input id="p-email" type="email" className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="p-phone">Phone</label>
                  <input id="p-phone" type="tel" className={inputCls} value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} placeholder="+234 803 000 0000" />
                  <p className="mt-1 text-[11px] text-slate-500">Matched when they join with a code.</p>
                </div>
              </>
            )}
            {contractors.length > 0 && (
              <div>
                <label className={labelCls} htmlFor="p-contractor">Contractor</label>
                <select id="p-contractor" className={inputCls} value={form.projectContractorId} onChange={(e) => setForm({ ...form, projectContractorId: e.target.value })}>
                  <option value="">None (independent)</option>
                  {contractors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.organizationName} ({c.tradeCode})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls} htmlFor="p-date">Planned mobilization date</label>
              <input id="p-date" type="date" className={inputCls} value={form.plannedMobilizationDate} onChange={(e) => setForm({ ...form, plannedMobilizationDate: e.target.value })} />
            </div>
            <div>
              <label className={labelCls} htmlFor="p-time">Expected check-in</label>
              <input id="p-time" type="time" className={inputCls} value={form.expectedCheckInTime} onChange={(e) => setForm({ ...form, expectedCheckInTime: e.target.value })} />
              <p className="mt-1 text-[11px] text-slate-500">Blank: start of the working day. Grace is 2 hours.</p>
            </div>
          </div>
          {!provisioned && form.email && (
            <p className="text-[11px] text-slate-500">The reminder email includes the role's join code. It is only sent to this address.</p>
          )}
          {formError && <p className="text-xs font-medium text-red-600">{formError}</p>}
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-lg bg-brand-primary px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Add participant
          </button>
        </form>
      )}
    </div>
  );
}
