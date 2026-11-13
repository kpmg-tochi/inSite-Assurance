import React from "react";

interface LogoProps {
  theme?: "light" | "dark";
  showText?: boolean;
  className?: string;
}

export const InSiteLogo: React.FC<LogoProps> = ({
  theme = "light",
  showText = true,
  className = "h-10",
}) => {
  const textColor = theme === "light" ? "#0c233c" : "#ffffff";
  const subTextColor = theme === "light" ? "#00338d" : "#60a5fa";

  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      {/* Original Isometric Angle & Colors + 3D Volumetric Blocks */}
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-auto shrink-0"
      >
        {/* ============================================================
            1. OUTER HEXAGONAL STRUCTURAL SHELL (Original Colors & Angle)
           ============================================================ */}
        {/* Outer Right & Bottom Base Shell (#0c233c - Brand Navy) */}
        <path d="M50 6 L88 28 V72 L50 94 L12 72 V28 L50 6 Z" fill="#0c233c" />
        {/* Outer Left Structural Wall (#00338d - Brand Primary) */}
        <path d="M50 6 L12 28 V58 L50 36 V6 Z" fill="#00338d" />

        {/* ============================================================
            2. INNER CORE: THIN BOTTOM 3D BLOCK (Drawn first for layering)
           ============================================================ */}
        {/* 3D Exposed Top Ledge - Left Wing */}
        <path d="M26 60 L29.5 58 L50 70 V74 L26 60 Z" fill="#d0e0f5" />
        {/* 3D Exposed Top Ledge - Right Wing */}
        <path d="M50 74 V70 L70.5 58 L74 60 L50 74 Z" fill="#e6eef8" />
        {/* Thin Bottom Block - Left Face */}
        <path d="M26 60 L50 74 V81.5 L26 67.5 V60 Z" fill="#00338d" />
        {/* Thin Bottom Block - Right Face */}
        <path d="M50 74 L74 60 V67.5 L50 81.5 V74 Z" fill="#00266b" />

        {/* ============================================================
            3. INNER CORE: 3D MIDDLE BAND (Narrow Block + Gap + Checkmark)
           ============================================================ */}
        {/* --- 3A. Narrow 3D Block on the far left --- */}
        {/* 3D Top Ledge of Narrow Block */}
        <path d="M26 49 L29.5 47 L36 50.8 L32.5 52.8 L26 49 Z" fill="#d0e0f5" />
        {/* Front-Left Face of Narrow Block */}
        <path d="M26 49 L32.5 52.8 V61.3 L26 57.5 V49 Z" fill="#00338d" />
        {/* 3D Inner Cutout Right Wall of Narrow Block (Gives 3D depth to the gap) */}
        <path d="M32.5 52.8 L36 50.8 V59.3 L32.5 61.3 V52.8 Z" fill="#00266b" />

        {/* --- 3B. Main 3D Checkmark Block (Bright #005eb8 / #0066cc) --- */}
        {/* 3DExposed Top Ledge of Checkmark Short Arm */}
        <path d="M36.5 55.1 L40 53.1 L50 59 V63 L36.5 55.1 Z" fill="#d0e0f5" />
        {/* 3D Exposed Top Ledge of Checkmark Long Arm */}
        <path d="M50 63 V59 L70.5 47 L74 49 L50 63 Z" fill="#e6eef8" />
        {/* Checkmark Short Arm (Left Face) */}
        <path d="M36.5 55.1 L50 63 V71.5 L36.5 63.6 V55.1 Z" fill="#005eb8" />
        {/* Checkmark Long Arm (Right Face) */}
        <path d="M50 63 L74 49 V57.5 L50 71.5 V63 Z" fill="#0066cc" />

        {/* ============================================================
            4. INNER CORE: TOP CAP & THIN TOP 3D BLOCK
           ============================================================ */}
        {/* Top White/Ice Rhombus Cap */}
        <path d="M50 25 L74 39 L50 53 L26 39 L50 25 Z" fill="#e6eef8" />
        {/* Thin Top Block - Left Face */}
        <path d="M26 39 L50 53 V60.5 L26 46.5 V39 Z" fill="#00338d" />
        {/* Thin Top Block - Right Face */}
        <path d="M50 53 L74 39 V46.5 L50 60.5 V53 Z" fill="#00266b" />
      </svg>
    </div>
  );
};
