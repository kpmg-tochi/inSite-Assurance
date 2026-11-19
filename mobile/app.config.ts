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
 */

const DEFAULT_BUNDLE_ID = "com.kpmg.insiteassurance.mobile";
export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = process.env.APP_VARIANT ?? "development";
  const demoMode = process.env.EXPO_PUBLIC_DEMO_MODE === "true";
  const suffix = variant === "production" ? "" : ` (${variant})`;
  const bundleId =
    process.env.APP_BUNDLE_ID?.trim() || config.ios?.bundleIdentifier || config.android?.package || DEFAULT_BUNDLE_ID;
  return {
    ...config,
    ios: { ...config.ios, bundleIdentifier: bundleId },
    android: { ...config.android, package: bundleId },
    name: `${config.name || "InSite Assurance Field"}${suffix}`,
    slug: config.slug || "insite-assurance-mobile",
    extra: {
      ...config.extra,
      demoMode: demoMode ? "true" : "false",
      appVariant: variant,
      eas: {
        ...(config.extra?.eas ?? {}),
        ...(process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : {}),
      },
    },
  };
};
