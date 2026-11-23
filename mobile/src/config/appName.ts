import Constants from "expo-constants";

/**
 * Platform name shown in the app. Set APPLICATION_NAME in mobile/.env (or the EAS build profile)
 * to white-label a build; app.config.ts passes it through `extra.applicationName`.
 */
export const APPLICATION_NAME: string =
  (Constants.expoConfig?.extra?.applicationName as string | undefined)?.trim() || "InSite Assurance";
