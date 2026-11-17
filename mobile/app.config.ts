import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name || "InSite Assurance Field",
  slug: config.slug || "insite-assurance-mobile",
  extra: {
    ...config.extra,
    demoMode:
      process.env.EXPO_PUBLIC_DEMO_MODE ?? process.env.DEMO_MODE ?? "false",
  },
});
