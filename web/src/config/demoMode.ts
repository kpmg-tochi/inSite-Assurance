/**
 * Build-time demo flag. Kept as a direct comparison on `import.meta.env` so Vite folds it to a
 * literal and drops demo-only code (and the demo account module) from non-demo bundles.
 */
export const IS_DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
