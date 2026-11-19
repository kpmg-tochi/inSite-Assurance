import type {
  AttendanceAlertActionRequest,
  CreateExpectedParticipantRequest,
  UpdateExpectedParticipantRequest,
} from "@insite/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  actOnAttendanceAlert,
  createParticipant,
  deleteParticipant,
  excuseReportingObligation,
  saveReminderSettings,
  updateParticipant,
} from "../../api/cadence/cadenceApi";
import { projectSetupKey } from "../../queries/projects/useProjectSetupQueries";

const errorMessage = (err: unknown) => (err as { message?: string })?.message;

export function useExcuseObligationMutation(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { obligationId: string; notes: string }) => excuseReportingObligation({ projectId: projectId!, ...p }),
    onSuccess: () => {
      toast.success("Report excused", { description: "The note is recorded in the audit ledger." });
      qc.invalidateQueries({ queryKey: ["project-obligations", projectId] });
      qc.invalidateQueries({ queryKey: ["project-cadence", projectId] });
      qc.invalidateQueries({ queryKey: ["audit-trail", projectId] });
    },
    onError: (err) => toast.error("Could not excuse the report", { description: errorMessage(err) }),
  });
}

export function useCreateParticipantMutation(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExpectedParticipantRequest) => createParticipant(projectId!, body),
    onSuccess: (p) => {
      toast.success(`${p.fullName} added to the expected team`);
      qc.invalidateQueries({ queryKey: ["project-participants", projectId] });
    },
    onError: (err) => toast.error("Could not add the participant", { description: errorMessage(err) }),
  });
}

export function useUpdateParticipantMutation(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { participantId: string; body: UpdateExpectedParticipantRequest }) =>
      updateParticipant(projectId!, p.participantId, p.body),
    onSuccess: (p) => {
      toast.success(p.mobilizationStatus === "WITHDRAWN" ? `${p.fullName} withdrawn` : `${p.fullName} updated`);
      qc.invalidateQueries({ queryKey: ["project-participants", projectId] });
    },
    onError: (err) => toast.error("Could not update the participant", { description: errorMessage(err) }),
  });
}

export function useDeleteParticipantMutation(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (participantId: string) => deleteParticipant(projectId!, participantId),
    onSuccess: () => {
      toast.success("Participant removed");
      qc.invalidateQueries({ queryKey: ["project-participants", projectId] });
    },
    onError: (err) => toast.error("Could not remove the participant", { description: errorMessage(err) }),
  });
}

export function useSaveReminderSettingsMutation(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reminderOffsetsDays: number[]) => saveReminderSettings(projectId!, { reminderOffsetsDays }),
    onSuccess: () => {
      toast.success("Reminder schedule saved");
      qc.invalidateQueries({ queryKey: ["project-participants", projectId] });
      qc.invalidateQueries({ queryKey: projectSetupKey(projectId!) });
    },
    onError: (err) => toast.error("Could not save the reminder schedule", { description: errorMessage(err) }),
  });
}

export function useAttendanceAlertActionMutation(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { alertId: string; body: AttendanceAlertActionRequest }) => actOnAttendanceAlert({ projectId: projectId!, ...p }),
    onSuccess: (alert) => {
      toast.success(`Alert ${alert.status.toLowerCase()}`);
      qc.invalidateQueries({ queryKey: ["project-attendance-alerts", projectId] });
      qc.invalidateQueries({ queryKey: ["project-cadence", projectId] });
      qc.invalidateQueries({ queryKey: ["audit-trail", projectId] });
    },
    onError: (err) => toast.error("Could not update the alert", { description: errorMessage(err) }),
  });
}
