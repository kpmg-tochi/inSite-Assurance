import { MouseEvent, ReactNode } from "react";

export default function Drawer({
  onClick,
  children,
}: {
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed -top-3 inset-0 bg-slate-950/35 backdrop-blur-[1px] z-50 flex justify-end p-3 transition-opacity"
      onClick={onClick}
    >
      <aside className="w-[440px] max-w-full h-full bg-white rounded-2xl border border-slate-200 shadow-2xl flex flex-col justify-between overflow-hidden">
        {children}
      </aside>
    </div>
  );
}
