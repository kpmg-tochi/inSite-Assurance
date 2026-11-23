import fs from 'node:fs';
import path from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';
import { API_BASE, PASSWORD, ROLES, storageStateFor, type Role } from './roles';

/**
 * Signs each role in once and saves its browser state, so specs do not sign in again.
 * Login is limited to 20 attempts per 15 minutes per IP (shared with the mobile track),
 * so a saved token is reused while /auth/me still accepts it.
 */
async function tokenStillValid(file: string): Promise<boolean> {
  if (!fs.existsSync(file)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entries: { name: string; value: string }[] = state.origins?.flatMap((o: any) => o.localStorage ?? []) ?? [];
    const token = entries.find((e) => /token/i.test(e.name) && e.value.split('.').length === 3)?.value;
    if (!token) return false;
    const res = await fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    return res.ok;
  } catch {
    return false;
  }
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL ?? 'http://localhost:5173';
  const browser = await chromium.launch();
  try {
    for (const role of Object.keys(ROLES) as Role[]) {
      const file = storageStateFor(role);
      if (await tokenStillValid(file)) continue;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const page = await browser.newPage({ baseURL });
      await page.goto('/login');
      await page.locator('input[type="email"]').fill(ROLES[role]);
      await page.locator('input[type="password"]').fill(PASSWORD);
      await page.getByRole('button', { name: /sign in to workspace/i }).click();
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
      await page.context().storageState({ path: file });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
