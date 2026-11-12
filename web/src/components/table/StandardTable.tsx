import React, { useState, useRef, useEffect, ReactNode } from 'react';
import {
  Search,
  MoreHorizontal,
  ChevronDown,
  Info,
  X,
  Check,
  AlertCircle,
} from 'lucide-react';

export type TableBadgeVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral';

interface TableBadgeProps {
  variant?: TableBadgeVariant;
  children: ReactNode;
  className?: string;
  title?: string;
}

/**
 * Standardized badge for table cells.
 * Adheres to strict rules: No icons, no text wrapping, standard color palette.
 */
export function TableBadge({
  variant = 'neutral',
  children,
  className = '',
  title,
}: TableBadgeProps) {
  const variantStyles: Record<TableBadgeVariant, string> = {
    success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
    danger: 'bg-rose-50 text-rose-700 border-rose-200',
    info: 'bg-blue-50 text-brand-primary border-blue-200',
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  };

  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap leading-tight transition-colors ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

export interface TableActionItem {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  icon?: ReactNode;
  variant?: 'default' | 'danger';
  disabled?: boolean;
}

interface TableActionMenuProps {
  actions: TableActionItem[];
  label?: string;
}

/**
 * Standardized ellipsis dropdown menu for rows with multiple actions.
 */
export function TableActionMenu({
  actions,
  label = 'Row actions',
}: TableActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (actions.length === 0) return null;

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition shadow-2xs hover:text-slate-900"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-1 w-44 rounded-xl bg-white border border-slate-200 shadow-xl py-1 z-30 animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          {actions.map((action, idx) => (
            <button
              key={idx}
              type="button"
              disabled={action.disabled}
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
                action.onClick(e);
              }}
              className={`w-full text-left px-3.5 py-2 text-xs flex items-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed ${
                action.variant === 'danger'
                  ? 'text-rose-700 hover:bg-rose-50'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {action.icon && <span className="w-4 h-4 shrink-0">{action.icon}</span>}
              <span className="truncate font-medium">{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface TableActionButtonProps {
  onClick: (e: React.MouseEvent) => void;
  children: ReactNode;
  variant?: 'default' | 'primary' | 'danger';
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
  title?: string;
}

/**
 * Standardized single action button for table row actions.
 */
export function TableActionButton({
  onClick,
  children,
  variant = 'default',
  icon,
  disabled = false,
  className = '',
  title,
}: TableActionButtonProps) {
  const variantStyles = {
    default:
      'border border-slate-200 hover:bg-slate-100 hover:text-slate-900 text-slate-700 bg-white shadow-2xs',
    primary:
      'bg-brand-primary hover:bg-brand-hover text-white shadow-2xs border border-transparent',
    danger:
      'border border-rose-200 hover:bg-rose-50 text-rose-700 bg-white shadow-2xs',
  };

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles[variant]} ${className}`}
    >
      {icon && <span className="w-3.5 h-3.5 shrink-0">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

export interface TableColumnDef<T> {
  id: string;
  header: ReactNode;
  tooltip?: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
  headerClassName?: string;
  cell: (item: T, index: number) => ReactNode;
}

export interface StandardTableProps<T> {
  title: ReactNode;
  subtitle?: ReactNode;
  headerActions?: ReactNode;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  filters?: ReactNode;
  columns: TableColumnDef<T>[];
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  onRowClick?: (item: T) => void;
  rowClassName?: (item: T, index: number) => string;
  selectedId?: string | null;
  emptyState?: {
    title?: string;
    description?: string;
    action?: ReactNode;
  };
  loading?: boolean;
  minWidth?: string;
  footer?: ReactNode;
  containerClassName?: string;
}

/**
 * Standardized Table Component.
 * - Dark Navy Header Bar
 * - Optional Search & Filters Toolbar
 * - Slightly Tinted Header Row with hover tooltip support
 * - Horizontally Scrollable Container
 * - Clean, uncluttered row cells
 */
export function StandardTable<T>({
  title,
  subtitle,
  headerActions,
  search,
  filters,
  columns,
  data,
  keyExtractor,
  onRowClick,
  rowClassName,
  selectedId,
  emptyState,
  loading = false,
  minWidth = 'min-w-[920px]',
  footer,
  containerClassName = '',
}: StandardTableProps<T>) {
  return (
    <div
      className={`bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col ${containerClassName}`}
    >
      {/* 1. Dark Navy Title Header Bar */}
      <div className="px-5 py-3.5 bg-brand-navy text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-white tracking-tight">
              {title}
            </h2>
          </div>
          {subtitle && (
            <div className="text-xs text-blue-200/80 mt-0.5 font-normal">
              {subtitle}
            </div>
          )}
        </div>

        {headerActions && (
          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
            {headerActions}
          </div>
        )}
      </div>

      {/* 2. Optional Toolbar: Search Bar & Filters */}
      {(search || filters) && (
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {search ? (
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                placeholder={search.placeholder || 'Search records...'}
                className="w-full text-xs pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition"
              />
              {search.value && (
                <button
                  type="button"
                  onClick={() => search.onChange('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div />
          )}

          {filters && (
            <div className="flex items-center gap-1.5 flex-wrap self-start sm:self-auto">
              {filters}
            </div>
          )}
        </div>
      )}

      {/* 3. Horizontally Scrollable Table Canvas */}
      <div className="overflow-x-auto">
        <table className={`w-full ${minWidth} text-left border-collapse`}>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
              {columns.map((col) => {
                const alignClass =
                  col.align === 'right'
                    ? 'text-right'
                    : col.align === 'center'
                    ? 'text-center'
                    : 'text-left';

                return (
                  <th
                    key={col.id}
                    title={col.tooltip}
                    className={`py-3 px-4 ${col.width || ''} ${alignClass} ${
                      col.headerClassName || ''
                    }`}
                  >
                    {col.tooltip ? (
                      <span className="underline decoration-dotted decoration-slate-300 underline-offset-4 cursor-help inline-flex items-center gap-1">
                        {col.header}
                      </span>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200/60 text-xs">
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="py-12 text-center text-slate-400 text-xs"
                >
                  Loading table data...
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="py-12 text-center text-slate-500"
                >
                  <div className="max-w-xs mx-auto space-y-1.5">
                    <div className="font-bold text-slate-700 text-xs">
                      {emptyState?.title || 'No records found'}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {emptyState?.description ||
                        'There are no entries matching the current filter criteria.'}
                    </p>
                    {emptyState?.action && (
                      <div className="pt-2">{emptyState.action}</div>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              data.map((item, index) => {
                const rowKey = keyExtractor(item, index);
                const isSelected = selectedId === rowKey;
                const customClasses = rowClassName ? rowClassName(item, index) : '';

                return (
                  <tr
                    key={rowKey}
                    onClick={() => onRowClick && onRowClick(item)}
                    className={`transition-colors ${
                      onRowClick ? 'cursor-pointer' : ''
                    } ${
                      isSelected
                        ? 'bg-blue-50/50 border-l-4 border-l-brand-primary'
                        : 'hover:bg-slate-50/70'
                    } ${customClasses}`}
                  >
                    {columns.map((col) => {
                      const alignClass =
                        col.align === 'right'
                          ? 'text-right'
                          : col.align === 'center'
                          ? 'text-center'
                          : 'text-left';

                      return (
                        <td
                          key={col.id}
                          className={`py-3.5 px-4 ${alignClass} ${
                            col.className || ''
                          }`}
                        >
                          {col.cell(item, index)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 4. Optional Table Footer */}
      {footer && (
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-500">
          {footer}
        </div>
      )}
    </div>
  );
}

