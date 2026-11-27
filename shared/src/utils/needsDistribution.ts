import { lgaByCode, stateByCode, zoneName, zoneOfState } from '../data/nigeriaAdminAreas';
import type { NeedsDistributionLevel } from '../schemas/needsPipeline.schema';

/**
 * Needs pipeline wave 4 (C1, plan section 9 "Approval review"): where the items of a submission land,
 * by zone, State or LGA. Pure. A proposal in several LGAs counts in full under each of them
 * (`sharedAcrossGroups`), as the payments breakdown does; the totals count each item once. Items
 * without a State or LGA go to "Not recorded".
 */
export interface DistributionItem {
  stateCode: string | null;
  lgaCodes: readonly string[];
  amountNgn: number | null;
}

export interface DistributionGroup {
  key: string;
  label: string;
  count: number;
  amountNgn: number;
  /** Share of the total amount, 0–100, one decimal. */
  sharePct: number;
  /** LGA level: an item in several LGAs counts in each, so the groups add up to more than the total. */
  sharedAcrossGroups: boolean;
}

const NOT_RECORDED_KEY = 'NONE';

export function needsDistribution(items: readonly DistributionItem[], level: NeedsDistributionLevel): { groups: DistributionGroup[]; count: number; amountNgn: number } {
  const total = items.reduce((s, i) => s + (i.amountNgn ?? 0), 0);
  const groups = new Map<string, DistributionGroup>();
  const add = (key: string, label: string, item: DistributionItem, shared: boolean) => {
    const g = groups.get(key) ?? { key, label, count: 0, amountNgn: 0, sharePct: 0, sharedAcrossGroups: false };
    g.count += 1;
    g.amountNgn += item.amountNgn ?? 0;
    g.sharedAcrossGroups = g.sharedAcrossGroups || shared;
    groups.set(key, g);
  };
  for (const item of items) {
    if (level === 'ZONE') {
      const zone = zoneOfState(item.stateCode);
      add(zone ?? NOT_RECORDED_KEY, zone ? (zoneName(zone) ?? zone) : 'Not recorded', item, false);
    } else if (level === 'STATE') {
      const state = stateByCode(item.stateCode);
      add(state?.code ?? NOT_RECORDED_KEY, state?.name ?? 'Not recorded', item, false);
    } else {
      const lgas = [...new Set(item.lgaCodes)];
      if (!lgas.length) add(NOT_RECORDED_KEY, 'Not recorded', item, false);
      for (const code of lgas) add(code, lgaByCode(code)?.name ?? code, item, lgas.length > 1);
    }
  }
  const out = [...groups.values()].map((g) => ({
    ...g,
    amountNgn: Math.round(g.amountNgn * 100) / 100,
    sharePct: total > 0 ? Math.round((g.amountNgn / total) * 1000) / 10 : 0,
  }));
  out.sort((a, b) => (a.key === NOT_RECORDED_KEY ? 1 : b.key === NOT_RECORDED_KEY ? -1 : b.amountNgn - a.amountNgn || a.label.localeCompare(b.label)));
  return { groups: out, count: items.length, amountNgn: Math.round(total * 100) / 100 };
}
