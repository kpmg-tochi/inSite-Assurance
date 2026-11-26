import { HTMLAttributes, ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The layer every modal and drawer sits on: above everything the page draws itself (Leaflet panes
 * and controls reach z-index 1000, map overlay cards 400, the mobile navigation drawer 900, the
 * notifications menu 1000). Toasts (sonner) sit higher still. Popovers that portal to the body from
 * inside a dialog (e.g. the project alert tooltip) use `OVERLAY_POPOVER_Z`.
 */
export const OVERLAY_Z = "z-[2000]";
export const OVERLAY_POPOVER_Z = "z-[2300]";

/**
 * Older call sites asked for a raised layer with these values (a confirmation over another dialog,
 * the unsaved-changes guard). They keep their order, now above the base layer.
 */
const RAISED: Record<string, string> = {
  "z-50": OVERLAY_Z,
  "z-[1000]": "z-[2100]",
  "z-[1100]": "z-[2200]",
};

/**
 * Full-screen backdrop for modals and drawers. Rendered into document.body so no page wrapper
 * (scroll container, transformed or filtered ancestor, a map's stacking context) can offset it or
 * draw over it; `-top-3` keeps the backdrop flush with the top edge, as fixed in the evidence drawer.
 */
export function Overlay({
  children,
  className = "",
  zIndex = OVERLAY_Z,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /** Tailwind z-index class; dialogs that must sit above other overlays pass a higher one. */
  zIndex?: string;
}) {
  return createPortal(
    <div
      {...rest}
      className={`fixed -top-3 inset-0 bg-slate-950/35 backdrop-blur-[1px] ${RAISED[zIndex] ?? zIndex} ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
