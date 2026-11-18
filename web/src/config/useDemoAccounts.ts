import { useEffect, useState } from "react";
import type { DemoAccount } from "./demoAccounts";

export type { DemoAccount };

/**
 * Loads the demo account module only in demo builds. The condition is written inline on
 * `import.meta.env` so the dynamic import is removed entirely from non-demo builds.
 */
export async function loadDemoAccounts(): Promise<{
  accounts: DemoAccount[];
  password: string;
} | null> {
  if (import.meta.env.VITE_DEMO_MODE === "true") {
    const mod = await import("./demoAccounts");
    return { accounts: mod.SEEDED_DEMO_ACCOUNTS, password: mod.DEMO_PASSWORD };
  }
  return null;
}

export function useDemoAccounts() {
  const [demo, setDemo] = useState<{ accounts: DemoAccount[]; password: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadDemoAccounts().then((d) => {
      if (!cancelled) setDemo(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return demo;
}
