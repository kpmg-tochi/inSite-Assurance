import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export interface CustomSelectOption<T extends string | number = string> {
  value: T;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  badge?: string;
  disabled?: boolean;
}

export interface CustomSelectProps<T extends string | number = string> {
  value: T;
  onChange: (value: T) => void;
  options: CustomSelectOption<T>[];
  placeholder?: string;
  label?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  searchable?: boolean;
  className?: string;
  triggerClassName?: string;
  dropdownClassName?: string;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "ghost" | "inline";
  /** id of the trigger button, so an outside <label htmlFor> names it. */
  id?: string;
  /** Accessible name when there is no visible label (the selected value is read after it). */
  ariaLabel?: string;
  renderTrigger?: (
    selectedOption: CustomSelectOption<T> | undefined,
    isOpen: boolean
  ) => React.ReactNode;
  renderOption?: (
    option: CustomSelectOption<T>,
    isSelected: boolean
  ) => React.ReactNode;
}

export function CustomSelect<T extends string | number = string>({
  value,
  onChange,
  options,
  placeholder = "Select an option...",
  label,
  hint,
  error,
  disabled = false,
  searchable = false,
  className = "",
  triggerClassName = "",
  dropdownClassName = "",
  size = "md",
  variant = "default",
  renderTrigger,
  renderOption,
  id,
  ariaLabel,
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const uid = useId();
  const labelId = `${uid}-label`;
  const valueId = `${uid}-value`;
  const listboxId = `${uid}-listbox`;
  const optionId = (i: number) => `${uid}-option-${i}`;
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Focus search input when opening if searchable
  useEffect(() => {
    if (isOpen && searchable) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery("");
    }
  }, [isOpen, searchable]);

  const filteredOptions = searchable && searchQuery.trim()
    ? options.filter(
        (opt) =>
          opt.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          opt.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          opt.badge?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : options;

  // The highlighted option starts on the selected one each time the list opens or the search changes.
  useEffect(() => {
    if (isOpen) {
      setActiveIndex(filteredOptions.findIndex((opt) => opt.value === value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, searchQuery]);

  useEffect(() => {
    if (isOpen && activeIndex >= 0) {
      document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeIndex]);

  const moveActive = (from: number, delta: number) => {
    const count = filteredOptions.length;
    if (count === 0) return;
    let next = from;
    for (let step = 0; step < count; step++) {
      next = next < 0 ? (delta > 0 ? 0 : count - 1) : (next + delta + count) % count;
      if (!filteredOptions[next].disabled) break;
    }
    setActiveIndex(next);
  };

  const choose = (opt: CustomSelectOption<T> | undefined) => {
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setIsOpen(false);
  };

  // Keyboard: Enter, Space or the arrows open the list; arrows, Home and End move; Enter (or Space on
  // the button) picks; Escape closes the list without closing a dialog around it; Tab closes it.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const inSearch = e.target === searchInputRef.current;

    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || (e.key === " " && !inSearch)) {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        break;
      case "Tab":
        setIsOpen(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        moveActive(activeIndex, 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveActive(activeIndex, -1);
        break;
      case "Home":
        if (inSearch) break;
        e.preventDefault();
        moveActive(-1, 1);
        break;
      case "End":
        if (inSearch) break;
        e.preventDefault();
        moveActive(-1, -1);
        break;
      case "Enter":
        e.preventDefault();
        choose(filteredOptions[activeIndex]);
        break;
      case " ":
        if (inSearch) break;
        e.preventDefault();
        choose(filteredOptions[activeIndex]);
        break;
    }
  };

  const sizeClasses = {
    sm: "px-2.5 py-1.5 text-[11px]",
    md: "px-3.5 py-2 text-xs",
    lg: "px-4 py-2.5 text-sm",
  }[size];

  const getVariantTriggerClasses = () => {
    if (variant === "ghost" || variant === "inline") {
      return "bg-transparent border-transparent hover:text-brand-primary text-slate-900";
    }
    return "bg-white border-slate-300 hover:border-slate-400 focus:border-brand-primary text-slate-900 shadow-xs";
  };

  return (
    <div
      ref={containerRef}
      className={`relative inline-block w-full text-left ${className}`}
      onKeyDown={handleKeyDown}
      // Space on a button clicks on key-up: keep it from toggling the list again after a keyboard pick.
      onKeyUp={(e) => {
        if (e.key === " " && e.target !== searchInputRef.current) e.preventDefault();
      }}
    >
      {label && (
        <label id={labelId} htmlFor={id} className="block text-xs font-semibold text-slate-700 mb-1">
          {label}
        </label>
      )}

      {/* Trigger Button */}
      {renderTrigger ? (
        <div
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className={`cursor-pointer ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {renderTrigger(selectedOption, isOpen)}
        </div>
      ) : (
        <button
          type="button"
          id={id}
          disabled={disabled}
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full rounded-xl border flex items-center justify-between gap-2 transition focus:outline-none ${sizeClasses} ${getVariantTriggerClasses()} ${
            disabled ? "opacity-50 cursor-not-allowed bg-slate-50" : "cursor-pointer"
          } ${isOpen ? "ring-2 ring-brand-primary/15 border-brand-primary" : ""} ${triggerClassName}`}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          aria-activedescendant={isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-label={label || id || !ariaLabel ? undefined : `${ariaLabel}: ${selectedOption ? selectedOption.label : placeholder}`}
          aria-labelledby={label && !id ? `${labelId} ${valueId}` : undefined}
        >
          <div className="flex items-center gap-2 min-w-0 truncate">
            {selectedOption?.icon && (
              <span className="shrink-0">{selectedOption.icon}</span>
            )}
            <span
              id={valueId}
              className={`truncate font-medium ${
                !selectedOption ? "text-slate-500" : ""
              }`}
            >
              {selectedOption ? selectedOption.label : placeholder}
            </span>
            {selectedOption?.badge && (
              <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand-primary/5 text-brand-primary border border-brand-primary/25">
                {selectedOption.badge}
              </span>
            )}
          </div>
          <ChevronDown
            className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
              isOpen ? "rotate-180 text-brand-primary" : ""
            }`}
          />
        </button>
      )}

      {/* Dropdown Popover */}
      {isOpen && (
        <div
          role="listbox"
          id={listboxId}
          aria-label={label ?? ariaLabel}
          className={`absolute left-0 mt-1.5 w-full min-w-[200px] z-50 bg-white rounded-xl border border-slate-200 shadow-xl py-1 overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100 ${dropdownClassName}`}
        >
          {searchable && (
            <div className="p-2 border-b border-slate-100">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search options..."
                  aria-label="Search options"
                  aria-controls={listboxId}
                  aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 rounded-lg border border-slate-200 focus:outline-none focus:border-brand-primary focus:bg-white"
                />
              </div>
            </div>
          )}

          <div className="max-h-60 overflow-y-auto divide-y divide-slate-50">
            {filteredOptions.length === 0 ? (
              <div className="py-3 px-3.5 text-center text-xs text-slate-400">
                No matching options found
              </div>
            ) : (
              filteredOptions.map((opt, index) => {
                const isSelected = opt.value === value;
                const isActive = index === activeIndex;
                return (
                  <div
                    key={String(opt.value)}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={opt.disabled || undefined}
                    onClick={() => choose(opt)}
                    onMouseEnter={() => !opt.disabled && setActiveIndex(index)}
                    className={`px-3.5 py-2 text-xs flex items-center justify-between gap-2.5 transition cursor-pointer select-none ${
                      opt.disabled
                        ? "opacity-40 cursor-not-allowed bg-slate-50"
                        : isSelected
                        ? "bg-brand-primary/5 text-brand-primary font-semibold"
                        : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    } ${isActive && !opt.disabled ? "outline outline-2 -outline-offset-2 outline-brand-primary/60" : ""}`}
                  >
                    {renderOption ? (
                      renderOption(opt, isSelected)
                    ) : (
                      <>
                        <div className="flex items-center gap-2.5 min-w-0">
                          {opt.icon && (
                            <span className="shrink-0">{opt.icon}</span>
                          )}
                          <div className="min-w-0">
                            <div className="truncate">{opt.label}</div>
                            {opt.description && (
                              <div className="text-[11px] text-slate-400 font-normal truncate mt-0.5">
                                {opt.description}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {opt.badge && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                              {opt.badge}
                            </span>
                          )}
                          {isSelected && (
                            <Check className="w-3.5 h-3.5 text-brand-primary shrink-0" />
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {hint && !error && (
        <p className="text-[11px] text-slate-400 mt-1">{hint}</p>
      )}
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
    </div>
  );
}
