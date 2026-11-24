import { InSiteLogo } from "./InSiteLogo";
import React from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { APPLICATION_NAME } from "../config/appName";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `px-3.5 py-2 rounded-xl text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
    isActive ? "bg-brand-primary/5 text-brand-primary" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
  }`;

/** Frame of the public pages (redesign R6f, D-R6.26): home, mobile app, sign-in. */
export function PublicLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-6 min-w-0">
            <Link to="/" className="flex items-center gap-3 min-w-0">
              <InSiteLogo showText={false} className="h-7" />
              <span className="font-bold text-sm text-slate-900 tracking-tight truncate">{APPLICATION_NAME}</span>
            </Link>
            <nav aria-label="Public pages" className="hidden md:flex items-center gap-1">
              <NavLink to="/" end className={navClass}>
                Overview
              </NavLink>
              <NavLink to="/mobile-app" className={navClass}>
                Mobile app
              </NavLink>
            </nav>
          </div>

          <Link
            to={user ? "/app" : "/login"}
            className="shrink-0 px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2"
          >
            {user ? "Open workspace" : "Sign in"}
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="bg-brand-navy text-slate-300 border-t border-white/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-white rounded-lg px-2 py-1">
              <InSiteLogo showText={false} className="h-5" />
            </div>
            <span className="font-semibold text-sm text-white">{APPLICATION_NAME}: programme delivery and site monitoring</span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-5 text-xs">
            <Link to="/" className="hover:text-white transition">
              Overview
            </Link>
            <Link to="/mobile-app" className="hover:text-white transition">
              Mobile app
            </Link>
            <Link to="/login" className="hover:text-white transition">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
