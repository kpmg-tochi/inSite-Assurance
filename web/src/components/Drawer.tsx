import { MouseEvent, ReactNode } from "react";
import { Overlay } from "./common/Overlay";

export default function Drawer({
  onClick,
  children,
}: {
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <Overlay className="flex justify-end p-3 transition-opacity" onClick={onClick}>
      <aside className="w-[440px] max-w-full h-full bg-white rounded-2xl border border-slate-200 shadow-2xl flex flex-col justify-between overflow-hidden">
        {children}
      </aside>
    </Overlay>
  );
}
