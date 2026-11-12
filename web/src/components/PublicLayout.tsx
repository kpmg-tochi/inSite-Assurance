import React from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth-context";

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Public Navigation Header */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-3">
              <img
                src="/KPMG-logo.svg"
                alt="KPMG"
                className="h-6 w-auto object-contain"
              />
              <div className="h-4 w-px bg-slate-300" />
              <div>
                <span className="font-bold text-sm text-slate-900 tracking-tight">
                  InSite Assurance
                </span>
                <span className="hidden sm:inline-block ml-2 text-[10px] font-semibold text-brand-primary bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  Pilot
                </span>
              </div>
            </Link>

            <nav className="hidden md:flex items-center gap-1">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
                    isActive
                      ? "bg-blue-50 text-brand-primary"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`
                }
              >
                Overview
              </NavLink>
              <NavLink
                to="/about"
                className={({ isActive }) =>
                  `px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
                    isActive
                      ? "bg-blue-50 text-brand-primary"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`
                }
              >
                Specification &amp; Context
              </NavLink>
              <NavLink
                to="/mobile-app"
                className={({ isActive }) =>
                  `px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
                    isActive
                      ? "bg-blue-50 text-brand-primary"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`
                }
              >
                Mobile Field App
              </NavLink>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {user ? (
              <Link
                to="/app/dashboard"
                className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm transition"
              >
                Open Workspace ({user.role})
              </Link>
            ) : (
              <Link
                to="/login"
                className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm transition"
              >
                Sign In to Portal
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      {/* Editorial Footer */}
      <footer className="bg-brand-navy text-slate-300 border-t border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="bg-white rounded-lg px-2 py-1">
                <img
                  src="/KPMG-logo.svg"
                  alt="KPMG"
                  className="h-4 w-auto object-contain"
                />
              </div>
              <span className="font-semibold text-sm text-white">
                InSite Assurance — Field Evidence &amp; Disbursement
                Reconciliation Platform
              </span>
            </div>
            <p className="text-xs text-blue-200/70 max-w-xl">
              Built for Nigerian infrastructure guarantors, project finance
              lenders, and licensed Independent Project Monitors (QSRBN /
              COREN).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs">
            <Link to="/" className="hover:text-white transition">
              Platform Overview
            </Link>
            <Link to="/about" className="hover:text-white transition">
              Validated Specification (v2.1)
            </Link>
            <Link to="/mobile-app" className="hover:text-white transition">
              Mobile Field App
            </Link>
            <Link to="/login" className="hover:text-white transition">
              Assurance Portal Login
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
