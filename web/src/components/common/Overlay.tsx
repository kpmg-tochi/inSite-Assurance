import { HTMLAttributes, ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Full-screen backdrop for modals and drawers. Rendered into document.body so no page wrapper
 * (scroll container, transformed or filtered ancestor) can offset it; `-top-3` keeps the
 * backdrop flush with the top edge, as fixed in the evidence drawer.
 */
export function Overlay({
  children,
  className = "",
  zIndex = "z-50",
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /** Tailwind z-index class; dialogs that must sit above other overlays pass a higher one. */
  zIndex?: string;
}) {
  return createPortal(
    <div
      {...rest}
      className={`fixed -top-3 inset-0 bg-slate-950/35 backdrop-blur-[1px] ${zIndex} ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
