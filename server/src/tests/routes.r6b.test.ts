/**
 * Redesign R6b: every web link the server emits (notification `actionUrl`s, checklist `linkTo`s, the
 * seed's notifications) points at a page the web portal defines, not at a route that only redirects.
 * A string check: the routes are read from `web/src/App.tsx`, the links from the server source.
 * No database.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '../../..');
const appTsx = fs.readFileSync(path.join(repoRoot, 'web/src/App.tsx'), 'utf8');

interface WebRoute {
  pattern: string;
  redirect: boolean;
}

/** The workspace routes (relative paths under /app/*), each marked page or redirect. */
function webRoutes(): WebRoute[] {
  const routes: WebRoute[] = [];
  const re = /path="([^"]+)"/g;
  const hits = [...appTsx.matchAll(re)];
  hits.forEach((m, i) => {
    const pattern = m[1];
    if (pattern.startsWith('/') || pattern === '*') return; // top-level public routes and fallbacks
    const end = i + 1 < hits.length ? hits[i + 1].index! : appTsx.length;
    const chunk = appTsx.slice(m.index!, end);
    routes.push({ pattern, redirect: /<Navigate/.test(chunk) });
  });
  return routes;
}

/** Tabs the merged pages accept in `?tab=` (KickoffMobilisationPage, CompletionHandoverPage, ProjectVisitsPage, AuditLedgerPage). */
const PAGE_TABS: Record<string, string[]> = {
  'projects/:projectId/kickoff': ['kickoff', 'milestones', 'mobilisation'],
  'projects/:projectId/completion': ['certificate', 'handover', 'defects', 'closure'],
  'projects/:projectId/visits': ['plan', 'findings', 'site-log'],
  'projects/:projectId/audit': ['ledger', 'tenant'],
};


function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tests') continue;
      listSourceFiles(full, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface EmittedLink {
  file: string;
  url: string;
}

/** Every `/app/...` link written in a string or template literal in server source (seed included). */
function emittedLinks(): EmittedLink[] {
  const links: EmittedLink[] = [];
  for (const file of listSourceFiles(path.join(repoRoot, 'server/src'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:actionUrl|linkTo|Url)\b[^\n]*?[`'"]([^`'"\n]*\/app\/[^`'"\n]*)[`'"]/g)) {
      const literal = m[1];
      const url = literal.slice(literal.indexOf('/app/')).replace(/\$\{[^}]*\}/g, 'X');
      links.push({ file: path.relative(repoRoot, file).replace(/\\/g, '/'), url });
    }
  }
  return links;
}

function matchRoute(routes: WebRoute[], pathPart: string): WebRoute | null {
  const segs = pathPart.replace(/^\/app\//, '').replace(/\/+$/, '').split('/');
  for (const r of routes) {
    const ps = r.pattern.split('/');
    let ok = true;
    for (let i = 0; i < ps.length; i++) {
      if (ps[i] === '*') return r;
      if (i >= segs.length || (ps[i].startsWith(':') ? !segs[i] : ps[i] !== segs[i])) {
        ok = false;
        break;
      }
    }
    if (ok && ps.length === segs.length) return r;
  }
  return null;
}

describe('R6b: server links point at web pages', () => {
  const routes = webRoutes();
  const links = emittedLinks();

  it('finds the routes and the links', () => {
    assert.ok(routes.some((r) => r.pattern === 'projects/:projectId/kickoff' && !r.redirect), 'kickoff page route');
    assert.ok(routes.some((r) => r.pattern === 'projects/:projectId/milestones' && r.redirect), 'milestones is a redirect');
    // Notifications from milestones, default cases, defects, handover, completion, lessons, visits, payments.
    assert.ok(links.length >= 15, `only ${links.length} links found`);
  });

  it('every link opens a page (not a redirect) with a known tab', () => {
    const problems: string[] = [];
    for (const { file, url } of links) {
      const [pathPart, query = ''] = url.split('#')[0].split('?');
      const route = matchRoute(routes, pathPart);
      if (!route) {
        problems.push(`${file}: ${url} matches no web route`);
        continue;
      }
      if (route.redirect) {
        problems.push(`${file}: ${url} points at a redirect (${route.pattern}); link to the page it redirects to`);
        continue;
      }
      const tab = new URLSearchParams(query).get('tab');
      if (tab && PAGE_TABS[route.pattern] && !PAGE_TABS[route.pattern].includes(tab)) {
        problems.push(`${file}: ${url} names tab "${tab}", which ${route.pattern} does not have`);
      }
    }
    assert.deepEqual(problems, []);
  });

  it('the merged pages are linked with their tabs', () => {
    const urls = links.map((l) => l.url);
    assert.ok(urls.some((u) => u.endsWith('/kickoff?tab=milestones&case=X')), 'default cases open the case');
    assert.ok(urls.some((u) => u.endsWith('/completion?tab=defects&ticket=X')), 'defect links keep the ticket');
    assert.ok(urls.some((u) => u.endsWith('/completion?tab=handover')));
    assert.ok(urls.some((u) => u.endsWith('/completion?tab=closure')));
    assert.ok(urls.some((u) => u.endsWith('/completion?tab=certificate')));
    for (const old of ['/milestones', '/handover', '/retention', '/closure']) {
      assert.ok(!urls.some((u) => u.split('?')[0].endsWith(old)), `no link to the old ${old} route`);
    }
  });
});
