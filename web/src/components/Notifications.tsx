import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  Check,
  AlertTriangle,
  UserCheck,
  Coins,
  FileQuestion,
  CheckCheck,
  X,
  ExternalLink,
} from "lucide-react";
import { formatDateTimeShort } from "../lib/formatters";

export type NotificationCategory =
  | "CONFLICT_FLAG"
  | "CONTRACTOR_ONBOARDING"
  | "TRANCHE_DISBURSEMENT"
  | "MONITOR_QUERY";

export interface InSiteNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  description: string;
  timestamp: string;
  isRead: boolean;
  actionUrl?: string;
  metadata?: {
    wbsCode?: string;
    ipcNumber?: number;
    agentName?: string;
    amountNgn?: number;
  };
}

const INITIAL_NOTIFICATIONS: InSiteNotification[] = [
  {
    id: "notif-1",
    category: "CONTRACTOR_ONBOARDING",
    title: "Contractor Assurance Verification",
    description:
      "Engr. Musa Danladi (J&S Civil) submitted photo ID and selfie liveness check for Lekki-Epe corridor.",
    timestamp: new Date(Date.now() - 1000 * 60 * 18).toISOString(), // 18 mins ago
    isRead: false,
    actionUrl: "/app/settings",
    metadata: {
      agentName: "Engr. Musa Danladi",
    },
  },
  {
    id: "notif-2",
    category: "CONFLICT_FLAG",
    title: "Pre-Pour Hold-Point Bypassed",
    description:
      "WBS 02.01.2 Box Culvert Concrete claim of 85% contradicts field log; pre-pour rebar inspection missing.",
    timestamp: new Date(Date.now() - 1000 * 60 * 42).toISOString(), // 42 mins ago
    isRead: false,
    actionUrl: "/app/reconciliation",
    metadata: {
      wbsCode: "02.01.2",
      ipcNumber: 2,
    },
  },
  {
    id: "notif-3",
    category: "MONITOR_QUERY",
    title: "Dispute Query Issued",
    description:
      "Formal query raised on WBS 02.01.1 regarding steel reinforcement batch test certificates.",
    timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(), // 2 hours ago
    isRead: false,
    actionUrl: "/app/reconciliation",
    metadata: {
      wbsCode: "02.01.1",
    },
  },
  {
    id: "notif-4",
    category: "TRANCHE_DISBURSEMENT",
    title: "Tranche #01 Release Certified",
    description:
      "Lender (InfraCredit) approved ₦2.108B drawdown release following 100% CPs satisfaction.",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1 day ago
    isRead: true,
    actionUrl: "/app/dashboard",
    metadata: {
      amountNgn: 2_108_000_000,
    },
  },
];

export default function Notifications() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<InSiteNotification[]>(
    INITIAL_NOTIFICATIONS,
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<"ALL" | "UNREAD">("ALL");
  const navigate = useNavigate();
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const handleToggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleMarkSelectedAsRead = () => {
    if (selectedIds.length === 0) return;
    setNotifications((prev) =>
      prev.map((n) =>
        selectedIds.includes(n.id) ? { ...n, isRead: true } : n,
      ),
    );
    setSelectedIds([]);
  };

  const handleMarkAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setSelectedIds([]);
  };

  const handleNotificationClick = (item: InSiteNotification) => {
    // Mark as read
    setNotifications((prev) =>
      prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)),
    );
    setOpen(false);

    if (item.actionUrl) {
      navigate(item.actionUrl);
    }
  };

  const getCategoryIcon = (category: NotificationCategory) => {
    switch (category) {
      case "CONFLICT_FLAG":
        return <AlertTriangle className="w-4 h-4 text-amber-600" />;
      case "CONTRACTOR_ONBOARDING":
        return <UserCheck className="w-4 h-4 text-brand-primary" />;
      case "TRANCHE_DISBURSEMENT":
        return <Coins className="w-4 h-4 text-emerald-600" />;
      case "MONITOR_QUERY":
        return <FileQuestion className="w-4 h-4 text-blue-600" />;
      default:
        return <Bell className="w-4 h-4 text-slate-500" />;
    }
  };

  const getCategoryBadgeClass = (category: NotificationCategory) => {
    switch (category) {
      case "CONFLICT_FLAG":
        return "bg-amber-50 text-amber-800 border-amber-200";
      case "CONTRACTOR_ONBOARDING":
        return "bg-blue-50 text-brand-primary border-blue-200";
      case "TRANCHE_DISBURSEMENT":
        return "bg-emerald-50 text-emerald-800 border-emerald-200";
      case "MONITOR_QUERY":
        return "bg-sky-50 text-sky-800 border-sky-200";
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
        title="Governance Notifications & Critical Flags"
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
              <span className="text-xs font-bold uppercase tracking-wider text-blue-200">
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
                  className="text-[11px] font-medium text-blue-200 hover:text-white transition flex items-center gap-1"
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

            {selectedIds.length > 0 && (
              <button
                type="button"
                onClick={handleMarkSelectedAsRead}
                className="text-[11px] font-semibold text-brand-primary hover:underline"
              >
                Mark selected read ({selectedIds.length})
              </button>
            )}
          </div>

          {/* Notifications Scroll Area */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 max-h-[380px]">
            {displayedNotifications.length === 0 ? (
              <div className="py-12 px-4 text-center">
                <Bell className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-600">
                  {filter === "UNREAD"
                    ? "All caught up! No unread notifications."
                    : "No notifications present."}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Critical project and evidence events will appear here.
                </p>
              </div>
            ) : (
              displayedNotifications.map((item) => {
                const isSelected = selectedIds.includes(item.id);
                return (
                  <div
                    key={item.id}
                    onClick={() => handleNotificationClick(item)}
                    className={`group px-3.5 py-3 cursor-pointer transition flex items-start gap-3 ${
                      !item.isRead
                        ? "bg-blue-50/40 hover:bg-blue-50/80"
                        : "hover:bg-slate-50/80"
                    }`}
                  >
                    {/* Select Checkbox / Category Icon */}
                    <div className="pt-0.5 shrink-0 flex items-center">
                      <button
                        type="button"
                        onClick={(e) => handleToggleSelect(item.id, e)}
                        title={isSelected ? "Deselect" : "Select"}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center border transition ${
                          isSelected
                            ? "bg-brand-primary text-white border-brand-primary"
                            : "bg-white text-slate-600 border-slate-200 group-hover:border-slate-300"
                        }`}
                      >
                        {isSelected ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          getCategoryIcon(item.category)
                        )}
                      </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${getCategoryBadgeClass(
                            item.category,
                          )}`}
                        >
                          {item.title}
                        </span>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">
                          {formatDateTimeShort(item.timestamp)}
                        </span>
                      </div>

                      <p className="text-xs text-slate-700 leading-snug font-normal line-clamp-2 mt-1">
                        {item.description}
                      </p>

                      <div className="mt-1.5 flex items-center justify-between">
                        {item.actionUrl && (
                          <span className="text-[11px] font-semibold text-brand-primary group-hover:underline flex items-center gap-1">
                            <span>Open details</span>
                            <ExternalLink className="w-3 h-3" />
                          </span>
                        )}
                        {!item.isRead && (
                          <span className="w-2 h-2 rounded-full bg-brand-primary shrink-0" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
