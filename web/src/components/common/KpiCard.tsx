import React from "react";

export type KpiIconVariant =
  | "blue"
  | "emerald"
  | "amber"
  | "rose"
  | "purple"
  | "indigo"
  | "slate";

export interface KpiCardProps {
  title: string;
  value: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  iconVariant?: KpiIconVariant;
  customIconClass?: string;
  valueColorClass?: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
  tooltip?: string;
}

const ICON_VARIANT_CLASSES: Record<KpiIconVariant, string> = {
  blue: "bg-blue-50 text-brand-primary",
  emerald: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  rose: "bg-rose-50 text-rose-700",
  purple: "bg-purple-50 text-purple-700",
  indigo: "bg-indigo-50 text-indigo-700",
  slate: "bg-slate-100 text-slate-700",
};

export function KpiCard({
  title,
  value,
  subtitle,
  icon,
  iconVariant = "blue",
  customIconClass,
  valueColorClass = "text-slate-900",
  badge,
  action,
  children,
  className = "",
  onClick,
  tooltip,
}: KpiCardProps) {
  const iconClasses = customIconClass || ICON_VARIANT_CLASSES[iconVariant];

  return (
    <div
      title={tooltip}
      onClick={onClick}
      className={`bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between transition ${
        onClick ? "cursor-pointer hover:border-brand-primary hover:shadow-md" : ""
      } ${className}`}
    >
      {/* Top Header: Icon on left, Title/Badge on right */}
      <div className="flex items-center justify-between gap-2">
        {icon ? (
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold shrink-0 ${iconClasses}`}
          >
            {icon}
          </div>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-2">
          {badge}
          <span className="text-[11px] font-medium text-slate-400 text-right truncate">
            {title}
          </span>
        </div>
      </div>

      {/* Main KPI Value & Subtitle */}
      <div className="mt-3">
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className={`text-2xl font-bold tracking-tight truncate ${valueColorClass}`}>
              {value}
            </div>
            {subtitle && (
              <div className="text-xs text-slate-500 mt-0.5 truncate">
                {subtitle}
              </div>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>

        {/* Optional Custom Injected Children (e.g., Progress/Ratio Bar or Distribution Rows) */}
        {children && <div className="mt-2.5">{children}</div>}
      </div>
    </div>
  );
}
