import Constants from "expo-constants";

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
  }
  return false;
}

const rawDemoMode =
  process.env.EXPO_PUBLIC_DEMO_MODE ??
  Constants.expoConfig?.extra?.demoMode;

export const IS_DEMO_MODE: boolean = parseBooleanFlag(rawDemoMode);
