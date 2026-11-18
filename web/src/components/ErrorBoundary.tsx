import React from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Top-level error boundary: a render error shows a recoverable message instead of a blank page.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[InSite] Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center space-y-3">
          <h1 className="text-base font-bold text-slate-900">Something went wrong</h1>
          <p className="text-xs text-slate-500">
            This page hit an unexpected error. Reload to try again. If it keeps happening, tell
            your administrator what you were doing when it occurred.
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-bold"
            >
              Reload page
            </button>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                window.location.assign("/app");
              }}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50"
            >
              Go to workspace
            </button>
          </div>
        </div>
      </div>
    );
  }
}
