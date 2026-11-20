import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  AlertTriangle,
  UserCheck,
  Coins,
  FileQuestion,
  FileCheck2,
  Sparkles,
  CheckCheck,
  X,
  ExternalLink,
  ShieldAlert,
  ClipboardCheck,
  Landmark,
} from "lucide-react";
import { formatElapsedTime, type WebNotificationCategory, type WebNotificationDto } from "@insite/shared";
import {
  useMarkAllWebNotificationsReadMutation,
  useMarkWebNotificationReadMutation,
  useWebNotificationsQuery,
} from "../queries/notifications/useWebNotificationsQueries";
import { useTerm } from "../lib/auth-context";

const CATEGORY_LABELS: Record<WebNotificationCategory, string> = {
  REPORT_RESUBMITTED: "Report resubmitted",
  CONFLICT_FLAG: "Evidence conflict",
  CONTRACTOR_ONBOARDING: "Contractor onboarding",
  TRANCHE_DISBURSEMENT: "Tranche disbursement",
  MONITOR_QUERY: "Monitor query",
  AI_OMISSION_FLAG: "Omission check",
  STANDARDS_VIOLATION_FLAGGED: "Standards violation",
  REPORT_PENDING_APPROVAL: "Report awaiting approval",
  DISBURSEMENT_PENDING_APPROVAL: "Disbursement awaiting approval",
  REPORT_MISSED: "Missed report",
  ATTENDANCE_ALERT: "Attendance alert",
  SCHEDULE_BEHIND: "Behind schedule",
  SCHEDULE_REVISION_PENDING: "Schedule revision awaiting approval",
  SCHEDULE_REVISION_DECIDED: "Schedule revision decided",
  HANDOVER_SUBMITTED: "Handover response",
  DEFECT_TICKET: "Defect",
  RETENTION_RELEASE: "Retention release",
  INSPECTION_PENDING_APPROVAL: "Inspection awaiting approval",
  INSPECTION_FINDING: "Inspection finding",
  INSPECTION_MISSED: "Missed inspection",
};

interface NotificationsProps {
  projectId?: string;
}

export default function Notifications({ projectId }: NotificationsProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "UNREAD">("ALL");
  const navigate = useNavigate();
  const term = useTerm();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const notificationsQuery = useWebNotificationsQuery(projectId, Boolean(projectId));
  const markReadMutation = useMarkWebNotificationReadMutation(projectId);
  const markAllReadMutation = useMarkAllWebNotificationsReadMutation(projectId);

  const notifications = notificationsQuery.data || [];

  // Close on outside click
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const displayedNotifications = notifications.filter((n) => {
    if (filter === "UNREAD") return !n.isRead;
    return true;
  });

  const handleMarkAllAsRead = () => {
    if (!projectId || unreadCount === 0) return;
    markAllReadMutation.mutate();
  };

  const handleNotificationClick = (item: WebNotificationDto) => {
    if (projectId && !item.isRead) {
      markReadMutation.mutate(item.id);
    }
    setOpen(false);

    if (item.actionUrl) {
      navigate(item.actionUrl);
    }
  };

  const getCategoryIcon = (category: WebNotificationCategory) => {
    switch (category) {
      case "REPORT_RESUBMITTED":
        return <FileCheck2 className="w-4 h-4 text-emerald-600" />;
      case "AI_OMISSION_FLAG":
        return <Sparkles className="w-4 h-4 text-amber-600" />;
      case "CONFLICT_FLAG":
        return <AlertTriangle className="w-4 h-4 text-rose-600" />;
      case "CONTRACTOR_ONBOARDING":
        return <UserCheck className="w-4 h-4 text-brand-primary" />;
      case "TRANCHE_DISBURSEMENT":
        return <Coins className="w-4 h-4 text-emerald-600" />;
      case "MONITOR_QUERY":
        return <FileQuestion className="w-4 h-4 text-brand-primary" />;
      case "STANDARDS_VIOLATION_FLAGGED":
        return <ShieldAlert className="w-4 h-4 text-rose-600" />;
      case "REPORT_PENDING_APPROVAL":
        return <ClipboardCheck className="w-4 h-4 text-amber-600" />;
      case "DISBURSEMENT_PENDING_APPROVAL":
        return <Landmark className="w-4 h-4 text-amber-600" />;
      default:
        return <Bell className="w-4 h-4 text-slate-500" />;
    }
  };

  const getCategoryLabel = (category: WebNotificationCategory) => {
    switch (category) {
      case "CONTRACTOR_ONBOARDING":
        return `${term("contractor")} onboarding`;
      case "TRANCHE_DISBURSEMENT":
        return `${term("tranche")} disbursement`;
      case "RETENTION_RELEASE":
        return `${term("retention")} release`;
      default:
        return CATEGORY_LABELS[category] ?? "Notification";
    }
  };

  const getCategoryBadgeClass = (category: WebNotificationCategory) => {
    switch (category) {
      case "REPORT_RESUBMITTED":
        return "bg-emerald-50 text-emerald-800 border-emerald-200";
      case "AI_OMISSION_FLAG":
        return "bg-amber-50 text-amber-800 border-amber-200";
      case "CONFLICT_FLAG":
        return "bg-rose-50 text-rose-800 border-rose-200";
      case "CONTRACTOR_ONBOARDING":
        return "bg-brand-primary/5 text-brand-primary border-brand-primary/25";
      case "TRANCHE_DISBURSEMENT":
        return "bg-emerald-50 text-emerald-800 border-emerald-200";
      case "MONITOR_QUERY":
        return "bg-brand-sky/10 text-brand-medium border-brand-sky/30";
      case "STANDARDS_VIOLATION_FLAGGED":
        return "bg-rose-50 text-rose-800 border-rose-200";
      case "REPORT_PENDING_APPROVAL":
      case "DISBURSEMENT_PENDING_APPROVAL":
        return "bg-amber-50 text-amber-800 border-amber-200";
      default:
        return "bg-slate-50 text-slate-700 border-slate-200";
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Header Bell Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Open governance notifications"
        title="Governance Notifications & Report Resubmissions"
        className="relative p-2 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 text-white transition flex items-center justify-center focus:outline-hidden"
      >
        <Bell className="w-4 h-4 text-slate-200 hover:text-white" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-white text-[10px] font-bold text-brand-primary shadow-sm">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Popover */}
      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 max-h-[500px] bg-white rounded-2xl shadow-2xl z-[1000] overflow-hidden flex flex-col text-slate-900 animate-in fade-in zoom-in-95 duration-100">
          {/* Popover Dark Navy Header */}
          <div className="bg-brand-primary px-4 py-3 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-white/75">
                Governance Alerts
              </span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-white text-brand-primary text-[10px] font-bold">
                  {unreadCount} unread
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllAsRead}
                  className="text-[11px] font-medium text-white/75 hover:text-white transition flex items-center gap-1"
                  title="Mark all notifications as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Mark all read</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition"
                aria-label="Close notifications popover"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Subheader Filter Bar */}
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFilter("ALL")}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  filter === "ALL"
                    ? "bg-white text-brand-primary shadow-xs border border-slate-200/80"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                All ({notifications.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("UNREAD")}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  filter === "UNREAD"
                    ? "bg-white text-brand-primary shadow-xs border border-slate-200/80"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Unread ({unreadCount})
              </button>
            </div>
          </div>

          {/* Notifications Scroll Area */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 max-h-[380px]">
            {displayedNotifications.length === 0 ? (
              <div className="py-12 px-4 text-center">
                <Bell className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-600">
                  {filter === "UNREAD"
                    ? "All caught up! No unread notifications."
                    : "No notifications present for this project."}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Resubmitted field reports, AI omissions, and {term("ipc", { lower: true })} flags appear here.
                </p>
              </div>
            ) : (
              displayedNotifications.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleNotificationClick(item)}
                  className={`group px-3.5 py-3 cursor-pointer transition flex items-start gap-3 ${
                    !item.isRead
                      ? "bg-brand-primary/5 hover:bg-brand-primary/5"
                      : "hover:bg-slate-50/80"
                  }`}
                >
                  <div className="pt-0.5 shrink-0 flex items-center">
                    <div
                      title={getCategoryLabel(item.category)}
                      aria-label={getCategoryLabel(item.category)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center border bg-white text-slate-600 border-slate-200"
                    >
                      {getCategoryIcon(item.category)}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border truncate ${getCategoryBadgeClass(
                          item.category,
                        )}`}
                      >
                        {getCategoryLabel(item.category)}
                      </span>
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">
                        {formatElapsedTime(item.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-900 leading-snug mt-1 line-clamp-1">{item.title}</p>

                    <p className="text-xs text-slate-700 leading-snug font-normal line-clamp-2 mt-0.5">
                      {item.description}
                    </p>

                    <div className="mt-1.5 flex items-center justify-between">
                      {item.actionUrl && (
                        <span className="text-[11px] font-semibold text-brand-primary group-hover:underline flex items-center gap-1">
                          <span>Inspect report</span>
                          <ExternalLink className="w-3 h-3" />
                        </span>
                      )}
                      {!item.isRead && (
                        <span className="w-2 h-2 rounded-full bg-brand-primary shrink-0" />
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
