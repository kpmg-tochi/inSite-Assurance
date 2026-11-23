import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Build-time config (Phase 4 Step 6). Values come from the EAS build profile (eas.json) or the
 * local environment:
 * - EAS_PROJECT_ID: the EAS project, needed for push tokens.
 * - EXPO_PUBLIC_API_BASE_URL: the API for preview, demo and production builds (https only).
 * - EXPO_PUBLIC_DEMO_MODE: "true" only in the demo profile.
 * - APP_VARIANT: development | preview | demo | production (app name suffix).
 * - APP_BUNDLE_ID: iOS bundle identifier and Android package (Phase 6). Set per build profile so a
 *   tenant-specific or white-label build can ship under its own identifier. Defaults to the value
 *   in app.json.
 * - APPLICATION_NAME: the platform name (white-labelling). Replaces "InSite Assurance" in the app
 *   name and permission prompts from app.json, and reaches the app as `extra.applicationName`
 *   (read it through `src/config/appName.ts`).
 */

const DEFAULT_BUNDLE_ID = "com.kpmg.insiteassurance.mobile";
const TEMPLATE_NAME = "InSite Assurance";

/** Replaces the template name in every string of a JSON-like value. */
function withAppName<T>(value: T, name: string): T {
  if (typeof value === "string") return value.split(TEMPLATE_NAME).join(name) as T;
  if (Array.isArray(value)) return value.map((v) => withAppName(v, name)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withAppName(v, name)])) as T;
  }
  return value;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = process.env.APP_VARIANT ?? "development";
  const demoMode = process.env.EXPO_PUBLIC_DEMO_MODE === "true";
  const suffix = variant === "production" ? "" : ` (${variant})`;
  const bundleId =
    process.env.APP_BUNDLE_ID?.trim() || config.ios?.bundleIdentifier || config.android?.package || DEFAULT_BUNDLE_ID;
  const applicationName = process.env.APPLICATION_NAME?.trim() || TEMPLATE_NAME;
  return {
    ...config,
    plugins: withAppName(config.plugins, applicationName),
    ios: { ...withAppName(config.ios, applicationName), bundleIdentifier: bundleId },
    android: { ...config.android, package: bundleId },
    name: `${withAppName(config.name || `${TEMPLATE_NAME} Field`, applicationName)}${suffix}`,
    slug: config.slug || "insite-assurance-mobile",
    extra: {
      ...config.extra,
      applicationName,
      demoMode: demoMode ? "true" : "false",
      appVariant: variant,
      eas: {
        ...(config.extra?.eas ?? {}),
        ...(process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : {}),
      },
    },
  };
};
