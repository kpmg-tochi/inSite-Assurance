import type { StandardsViolationItem } from '@insite/shared';

/**
 * Rule-based standards check (Phase 7 Step 5), used when no AI provider is available or it fails.
 *
 * It reads two kinds of rule from a standard's text:
 * - numeric tolerances: "<test> 75 ± 25 mm", "<test> minimum 95 %", "<test> maximum 0.5",
 *   "<test> between 50 and 100 mm";
 * - required tests or proof: keywords such as cube, slump, mill certificate, density, photo.
 * and compares them with what the report says and the captures attached. When no standard yields a
 * rule it can check, the result is undecided (`passed: null`, shown as "not checked").
 *
 * A violation is CRITICAL when the standard is mandatory, otherwise a WARNING. The report fails the
 * check only on a CRITICAL violation.
 */

export interface RuleStandard {
  code: string;
  title: string;
  specificationText: string;
  isMandatory: boolean;
}

export interface RuleReportEvidence {
  /** Summary, blockers, text notes, capture captions and transcripts. */
  text: string;
  /** Media types of the captures that passed integrity checks. */
  captureMediaTypes: string[];
  reportedQuantity: number;
}

export interface RuleCheckResult {
  decided: boolean;
  passed: boolean | null;
  violations: StandardsViolationItem[];
  reasoning: string;
}

type NumericRule = {
  kind: 'NUMERIC';
  aliases: string[];
  label: string;
  min: number | null;
  max: number | null;
  unit: string | null;
  source: string;
};

type TestRule = {
  kind: 'TEST';
  keyword: string;
  label: string;
  /** Text that shows the test was done or recorded. */
  textPatterns: RegExp[];
  /** Capture types that count as the proof. */
  mediaTypes: string[];
};

type Rule = NumericRule | TestRule;

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const UNIT = String.raw`(mm|cm|m|%|n\/mm²|n\/mm2|mpa|kn|°c|kg\/m³|kg\/m3)?`;
const STOPWORDS = new Set(['the', 'for', 'and', 'with', 'of', 'a', 'an', 'to', 'be', 'is', 'at', 'in', 'on', 'all', 'each', 'every', 'per', 'unless']);

function normaliseUnit(u: string | null | undefined): string | null {
  if (!u) return null;
  const v = u.toLowerCase().replace('²', '2').replace('³', '3');
  return v === 'mpa' ? 'n/mm2' : v;
}

function aliasesFrom(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .slice(-3);
}

/** Splits text into clauses so a rule never spans two requirements. */
function clauses(text: string): string[] {
  return text
    .split(/(?<=[.;\n])\s+|;\s*/)
    .map((c) => c.trim())
    .filter(Boolean);
}

export function extractNumericRules(text: string): NumericRule[] {
  const rules: NumericRule[] = [];
  const subject = String.raw`([A-Za-z][A-Za-z \-]{1,40}?)`;
  const patterns: Array<{ re: RegExp; build: (m: RegExpExecArray) => Omit<NumericRule, 'kind' | 'aliases' | 'label' | 'source'> }> = [
    {
      re: new RegExp(`${subject}\\s+${NUM}\\s*(?:±|\\+\\/-|\\+-)\\s*${NUM}\\s*${UNIT}`, 'gi'),
      build: (m) => {
        const centre = Number(m[2]);
        const tol = Number(m[3]);
        return { min: centre - tol, max: centre + tol, unit: normaliseUnit(m[4]) };
      },
    },
    {
      re: new RegExp(`${subject}\\s+(?:between|from)\\s+${NUM}\\s*(?:and|to|-|–)\\s*${NUM}\\s*${UNIT}`, 'gi'),
      build: (m) => ({ min: Number(m[2]), max: Number(m[3]), unit: normaliseUnit(m[4]) }),
    },
    {
      re: new RegExp(`${subject}\\s+(?:minimum(?: of)?|min\\.?|at least|not less than|≥|>=)\\s*${NUM}\\s*${UNIT}`, 'gi'),
      build: (m) => ({ min: Number(m[2]), max: null, unit: normaliseUnit(m[3]) }),
    },
    {
      re: new RegExp(`${subject}\\s+(?:maximum(?: of)?|max\\.?|not more than|not exceeding|at most|≤|<=)\\s*${NUM}\\s*${UNIT}`, 'gi'),
      build: (m) => ({ min: null, max: Number(m[2]), unit: normaliseUnit(m[3]) }),
    },
  ];
  for (const clause of clauses(text)) {
    for (const { re, build } of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(clause)) !== null) {
        const aliases = aliasesFrom(m[1]);
        if (aliases.length === 0) continue;
        rules.push({ kind: 'NUMERIC', aliases, label: m[1].trim(), source: m[0].trim(), ...build(m) });
      }
    }
  }
  return rules;
}

const TEST_KEYWORDS: Array<{ keyword: string; label: string; detect: RegExp; textPatterns: RegExp[]; mediaTypes: string[] }> = [
  { keyword: 'cube', label: 'cube test', detect: /\bcube/i, textPatterns: [/\bcubes?\b/i], mediaTypes: ['LAB_CUBE_TEST_CERT'] },
  { keyword: 'slump', label: 'slump test', detect: /\bslump/i, textPatterns: [/\bslump/i], mediaTypes: [] },
  {
    keyword: 'mill certificate',
    label: 'mill certificate',
    detect: /\bmill cert/i,
    textPatterns: [/\bmill cert/i],
    mediaTypes: ['MILL_CERTIFICATE'],
  },
  {
    keyword: 'test certificate',
    label: 'test certificate',
    detect: /\btest certificate|\btest sheet|\blab(?:oratory)? (?:test|result)/i,
    textPatterns: [/\btest (?:certificate|sheet|result)|\blab(?:oratory)? (?:test|result)/i],
    mediaTypes: ['LAB_CUBE_TEST_CERT', 'MILL_CERTIFICATE'],
  },
  {
    keyword: 'density',
    label: 'field density / compaction test',
    detect: /\b(?:field density|density test|dry density|compaction test)/i,
    textPatterns: [/\bdensity|\bcompaction/i],
    mediaTypes: ['LAB_CUBE_TEST_CERT'],
  },
  { keyword: 'photo', label: 'photo', detect: /\bphoto/i, textPatterns: [], mediaTypes: ['SITE_PHOTO'] },
  { keyword: 'waybill', label: 'waybill', detect: /\bwaybill/i, textPatterns: [/\bwaybill/i], mediaTypes: ['WAYBILL_DOCUMENT'] },
];

export function extractTestRules(text: string): TestRule[] {
  return TEST_KEYWORDS.filter((t) => t.detect.test(text)).map((t) => ({
    kind: 'TEST' as const,
    keyword: t.keyword,
    label: t.label,
    textPatterns: t.textPatterns,
    mediaTypes: t.mediaTypes,
  }));
}

export function extractRules(text: string): Rule[] {
  return [...extractNumericRules(text), ...extractTestRules(text)];
}

/** The first value the report gives for one of the aliases, before or after the word. */
export function findReportedValue(text: string, aliases: string[]): { value: number; unit: string | null } | null {
  for (const alias of aliases) {
    const a = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const after = new RegExp(`\\b${a}\\w*[^0-9\\n.;]{0,25}?${NUM}\\s*${UNIT}`, 'i').exec(text);
    if (after) return { value: Number(after[1]), unit: normaliseUnit(after[2]) };
    const before = new RegExp(`${NUM}\\s*${UNIT}\\s+(?:[a-z]+\\s+){0,2}${a}`, 'i').exec(text);
    if (before) return { value: Number(before[1]), unit: normaliseUnit(before[2]) };
  }
  return null;
}

function fmtBound(rule: NumericRule): string {
  const u = rule.unit ? ` ${rule.unit}` : '';
  if (rule.min !== null && rule.max !== null) return `${rule.min} to ${rule.max}${u}`;
  if (rule.min !== null) return `at least ${rule.min}${u}`;
  return `at most ${rule.max}${u}`;
}

export function evaluateStandardsByRules(standards: RuleStandard[], evidence: RuleReportEvidence): RuleCheckResult {
  const violations: StandardsViolationItem[] = [];
  const notes: string[] = [];
  let checkedRules = 0;
  const workDone = evidence.reportedQuantity > 0;

  for (const std of standards) {
    const severity = std.isMandatory ? 'CRITICAL' : 'WARNING';
    const rules = extractRules(std.specificationText);
    const missingProof: TestRule[] = [];
    for (const rule of rules) {
      if (rule.kind === 'NUMERIC') {
        const found = findReportedValue(evidence.text, rule.aliases);
        // No value reported: nothing to compare. Some values (e.g. 28-day cube strength) cannot
        // exist yet on the day of the work; whether the test was done is a TEST rule.
        if (!found) continue;
        if (rule.unit && found.unit && rule.unit !== found.unit) {
          notes.push(`${std.code}: ${rule.label} reported in ${found.unit}, standard uses ${rule.unit}; not compared.`);
          continue;
        }
        checkedRules += 1;
        const below = rule.min !== null && found.value < rule.min;
        const above = rule.max !== null && found.value > rule.max;
        if (below || above) {
          violations.push({
            standardCode: std.code,
            standardTitle: std.title,
            severity,
            violationSummary: `Reported ${rule.label.toLowerCase()} ${found.value}${found.unit ? ` ${found.unit}` : ''} is outside the required ${fmtBound(rule)}.`,
            requiredRectification: `Explain the deviation and the corrective action, or re-test and report a value within ${fmtBound(rule)}.`,
          });
        }
        continue;
      }
      // Required test or proof: only expected on a day with reported work.
      if (!workDone) continue;
      checkedRules += 1;
      const inText = rule.textPatterns.some((p) => p.test(evidence.text));
      const inCaptures = rule.mediaTypes.some((t) => evidence.captureMediaTypes.includes(t));
      if (!inText && !inCaptures) missingProof.push(rule);
    }
    // One finding per standard for missing proof, listing what is missing.
    if (missingProof.length > 0) {
      const labels = missingProof.map((r) => r.label).join(', ');
      violations.push({
        standardCode: std.code,
        standardTitle: std.title,
        severity,
        violationSummary: `Not recorded or attached: ${labels}.`,
        requiredRectification: `Attach or record the ${labels} (or its reference), or say why it is not available yet.`,
      });
    }
  }

  if (checkedRules === 0) {
    return {
      decided: false,
      passed: null,
      violations: [],
      reasoning: standards.length
        ? 'Rules check: none of the applicable standards has a value or test the rules can check. Not checked.'
        : 'No standards apply to this item. Not checked.',
    };
  }
  const passed = !violations.some((v) => v.severity === 'CRITICAL');
  return {
    decided: true,
    passed,
    violations,
    reasoning: `Rules check: ${checkedRules} requirement(s) checked against ${standards.length} standard(s); ${violations.length} issue(s).${
      notes.length ? ` ${notes.join(' ')}` : ''
    }`,
  };
}
