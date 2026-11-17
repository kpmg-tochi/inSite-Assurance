const rawDemoMode =
  import.meta.env.VITE_DEMO_MODE ?? import.meta.env.DEMO_MODE;

export const IS_DEMO_MODE =
  typeof rawDemoMode === "boolean"
    ? rawDemoMode
    : typeof rawDemoMode === "string"
      ? ["true", "1", "yes", "on"].includes(rawDemoMode.trim().toLowerCase())
      : false;
