import { MouseEvent, ReactNode, useRef } from "react";
import { Overlay } from "./common/Overlay";
import { useDialogFocus } from "./common/ModalShell";

const ASIDE_CLASS = "w-[440px] max-w-full h-full bg-white rounded-2xl border border-slate-200 shadow-2xl flex flex-col justify-between overflow-hidden focus:outline-none";

/**
 * Side drawer. With `onClose` it is a modal dialog (named by `label`): focus moves in on open,
 * Tab stays inside, Escape closes and focus returns to the control that opened it.
 */
export default function Drawer({
  onClick,
  onClose,
  label,
  labelledBy,
  children,
}: {
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  onClose?: () => void;
  label?: string;
  /** Id of the drawer heading; preferred over label. */
  labelledBy?: string;
  children: ReactNode;
}) {
  return (
    <Overlay className="flex justify-end p-3 transition-opacity" onClick={onClick}>
      {onClose ? (
        <DialogAside onClose={onClose} label={label} labelledBy={labelledBy}>
          {children}
        </DialogAside>
      ) : (
        <aside className={ASIDE_CLASS}>{children}</aside>
      )}
    </Overlay>
  );
}

function DialogAside({ onClose, label, labelledBy, children }: { onClose: () => void; label?: string; labelledBy?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const onKeyDown = useDialogFocus(ref, onClose);
  return (
    <aside ref={ref} role="dialog" aria-modal="true" aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} tabIndex={-1} onKeyDown={onKeyDown} className={ASIDE_CLASS}>
      {children}
    </aside>
  );
}
