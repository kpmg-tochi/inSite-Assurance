import { lazy, Suspense } from "react";
import type { ApexChartImplProps } from "./ApexChartImpl";

const ApexChartImpl = lazy(() => import("./ApexChartImpl"));

export function ChartSkeleton({ height }: { height: number }) {
  return <div style={{ height }} className="w-full animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" aria-hidden="true" />;
}

/**
 * An ApexCharts chart, lazy-loaded. `summary` is the chart's accessible name (one sentence of what it
 * shows); the values are in the panel's "View as table".
 */
export function LazyChart({ summary, ...props }: ApexChartImplProps & { summary: string }) {
  return (
    <div role="img" aria-label={summary} style={{ minHeight: props.height }} className="w-full min-w-0">
      <Suspense fallback={<ChartSkeleton height={props.height} />}>
        <ApexChartImpl {...props} />
      </Suspense>
    </div>
  );
}
