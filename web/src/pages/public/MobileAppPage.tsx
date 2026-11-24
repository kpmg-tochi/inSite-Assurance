import React from "react";
import { Link } from "react-router-dom";
import { PublicLayout } from "../../components/PublicLayout";
import { APPLICATION_NAME } from "../../config/appName";

const STEPS = [
  {
    title: "Sign in with your account",
    text: "Your programme administrator creates your account and assigns you to projects. Sign in on the phone with the same email and password as the web portal.",
  },
  {
    title: "See your visits",
    text: "The app lists the visits assigned to you on every project. Confirm a visit, move it within the allowed days, or propose another date.",
  },
  {
    title: "Fill the visit form on site",
    text: "Check in at the site, answer the visit form for each facility, and add photos and voice notes. It works without a connection.",
  },
  {
    title: "Submit when you are back online",
    text: "Submissions wait on the phone and are sent when the connection returns. The project team reviews them on the web portal.",
  },
];

/** Public page about the field app (redesign R6f, D-R6.26): account sign-in only. */
export function MobileAppPage() {
  return (
    <PublicLayout>
      <section className="kpmg-ribbed-panel text-white border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 space-y-5">
          <h1 className="text-3xl sm:text-4xl font-bold leading-tight max-w-3xl">The {APPLICATION_NAME} field app</h1>
          <p className="text-sm sm:text-base text-white/90 leading-relaxed max-w-2xl">
            For monitoring officers and site supervisors: your visits, the visit forms, photos, voice notes and the site log, on Android and iOS.
          </p>
          <p className="text-xs text-white/80">Ask your programme administrator for the app download link.</p>
        </div>
      </section>

      <section aria-labelledby="mobile-steps" className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <h2 id="mobile-steps" className="text-lg font-bold text-slate-900">
          How it works
        </h2>
        <ol className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-1.5">
              <span className="text-xs font-semibold text-slate-500">Step {i + 1}</span>
              <h3 className="text-sm font-bold text-slate-900">{step.title}</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{step.text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 text-sm text-slate-600">
          Reviewing visits, findings and payments happens on the web portal.{" "}
          <Link to="/login" className="font-semibold text-brand-primary hover:underline">
            Sign in
          </Link>
          .
        </p>
      </section>
    </PublicLayout>
  );
}
