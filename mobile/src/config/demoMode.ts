/**
 * Build-time demo flag. Expo inlines EXPO_PUBLIC_* variables at bundle time, so
 * `process.env.EXPO_PUBLIC_DEMO_MODE === "true"` becomes a literal and the minifier removes demo
 * branches from non-demo builds. Use the expression inline (or this constant inside the same
 * module) where code must be compiled out; an imported constant is not folded across modules.
 */
export const IS_DEMO_MODE: boolean = process.env.EXPO_PUBLIC_DEMO_MODE === "true";
