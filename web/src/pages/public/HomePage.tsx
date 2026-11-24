import React from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ClipboardList, Flag, Handshake, ShieldCheck, Wallet } from "lucide-react";
import { PublicLayout } from "../../components/PublicLayout";
import { APPLICATION_NAME } from "../../config/appName";

const STAGES = ["Kick-off", "Mobilisation", "Construction", "Completion", "Closure"];

const FEATURES = [
  {
    icon: Flag,
    title: "Kick-off and mobilisation",
    text: "Contract milestones dated from award, signing and kick-off; the kick-off notice, attendance and minutes; the contractor's arrival on site.",
  },
  {
    icon: ClipboardList,
    title: "Scope and sprints",
    text: "Facility units, bill of quantities and sprints from one needs-assessment workbook, with each sprint verified when it ends.",
  },
  {
    icon: CalendarDays,
    title: "Monitoring visits",
    text: "A visit plan per project. Officers confirm their visits, fill the visit form on the phone, offline if needed, with photos and voice notes.",
  },
  {
    icon: Wallet,
    title: "Payments and retention",
    text: "Payments made outside the platform are recorded against the contract sum, with retention held and checks before final payment and release.",
  },
  {
    icon: Handshake,
    title: "Completion and handover",
    text: "The Certificate of Completion with its signatures, the beneficiary's handover response, defects and the closure checklist.",
  },
  {
    icon: ShieldCheck,
    title: "Audit trail",
    text: "Every decision and change is written to a tamper-evident ledger, and a closure pack collects the project's record when it ends.",
  },
];

/** Public home (redesign R6f, D-R6.26): a short product page with sign-in. */
export function HomePage() {
  return (
    <PublicLayout>
      <section className="kpmg-ribbed-panel text-white border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 lg:py-20">
          <div className="max-w-3xl space-y-6">
          <h1 className="text-3xl sm:text-4xl font-bold leading-tight tracking-tight">Run every project in the programme from kick-off to closure.</h1>
          <p className="text-sm sm:text-base text-white/90 leading-relaxed">
            {APPLICATION_NAME} keeps the programme team, monitoring officers and funders on one record: what was agreed, what the site visits
            found, what was paid and what is left before the project closes.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/login"
              className="px-5 py-3 rounded-xl bg-white text-brand-primary hover:bg-slate-100 text-sm font-bold shadow-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-navy"
            >
              Sign in
            </Link>
            <Link
              to="/mobile-app"
              className="px-5 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/25 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              The field app
            </Link>
          </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="home-stages" className="max-w-6xl mx-auto px-4 sm:px-6 pt-12">
        <h2 id="home-stages" className="text-lg font-bold text-slate-900">
          One project, five stages
        </h2>
        <ol className="mt-4 flex flex-col sm:flex-row gap-2">
          {STAGES.map((stage, i) => (
            <li key={stage} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
              <span className="text-xs font-semibold text-slate-500">Stage {i + 1}</span>
              <span className="block font-bold text-slate-900">{stage}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="home-features" className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <h2 id="home-features" className="text-lg font-bold text-slate-900">
          What the team works with
        </h2>
        <ul className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-2">
              <Icon className="w-5 h-5 text-brand-primary" aria-hidden="true" />
              <h3 className="text-sm font-bold text-slate-900">{title}</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{text}</p>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-sm text-slate-600">
          Accounts are created by your programme administrator.{" "}
          <Link to="/login" className="font-semibold text-brand-primary hover:underline">
            Sign in
          </Link>{" "}
          with the email address they registered.
        </p>
      </section>
    </PublicLayout>
  );
}
