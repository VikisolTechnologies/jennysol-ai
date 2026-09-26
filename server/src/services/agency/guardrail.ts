import type { AgencyScorecardDraft, CitedItem } from "./scorecardSchema.js";

// Founder Outreach Pack §"Data and candidate protections": names, photographs, and protected
// personal characteristics are never used as ranking signals. This is the enforcement point —
// any criterion the model drafted that names one of these gets stripped before the recruiter
// ever sees it as a "must-have"/"nice-to-have"/"disqualifier", not just discouraged in the prompt.
// Deliberately broad and case-insensitive: a false positive (stripping something borderline) is
// the safe failure mode here, a false negative is not.
const PROTECTED_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "gender", pattern: /\b(male|female|man|woman|men|women|gender|sex)\b/i },
  {
    label: "age",
    pattern:
      /\b(age[sd]?|young|senior citizen|\d{1,2}\s*(-|to)\s*\d{1,2}\s*years?\s*old|born (in|after|before)|(under|over|below|above)\s+\d{1,2}\b)\b/i,
  },
  { label: "religion", pattern: /\b(hindu|muslim|christian|sikh|buddhist|jain|religion|religious)\b/i },
  { label: "caste", pattern: /\b(caste|brahmin|dalit|obc|sc\/st)\b/i },
  { label: "marital status", pattern: /\b(married|unmarried|single|divorced|widow(ed)?|marital)\b/i },
  { label: "disability", pattern: /\b(disab(led|ility)|handicapped|able-bodied)\b/i },
  { label: "photo", pattern: /\b(photo|photograph|headshot|selfie|appearance|looks)\b/i },
  { label: "name", pattern: /\b(surname|last name|first name|caste name)\b/i },
];

export interface GuardrailRemoval {
  field: string;
  value: string;
  reason: string;
}

function isClean(item: CitedItem): boolean {
  return !PROTECTED_PATTERNS.some(({ pattern }) => pattern.test(item.value) || pattern.test(item.quote));
}

function reasonFor(item: CitedItem): string {
  const hit = PROTECTED_PATTERNS.find(({ pattern }) => pattern.test(item.value) || pattern.test(item.quote));
  return hit ? hit.label : "protected attribute";
}

function filterList(field: string, items: CitedItem[], removed: GuardrailRemoval[]): CitedItem[] {
  const kept: CitedItem[] = [];
  for (const item of items) {
    if (isClean(item)) {
      kept.push(item);
    } else {
      removed.push({ field, value: item.value, reason: reasonFor(item) });
    }
  }
  return kept;
}

// Runs after the model draft parses successfully, before persistence — a caller never sees an
// unfiltered draft. Returns what was removed so the caller (and the eval) can prove leakage is 0,
// not just assert it.
export function applyGuardrail(draft: AgencyScorecardDraft): { draft: AgencyScorecardDraft; removed: GuardrailRemoval[] } {
  const removed: GuardrailRemoval[] = [];
  const cleaned: AgencyScorecardDraft = {
    ...draft,
    mustHave: filterList("mustHave", draft.mustHave, removed),
    niceToHave: filterList("niceToHave", draft.niceToHave, removed),
    disqualifiers: filterList("disqualifiers", draft.disqualifiers, removed),
    booleanSearchStrings: draft.booleanSearchStrings.filter((s) => {
      const clean = !PROTECTED_PATTERNS.some(({ pattern }) => pattern.test(s));
      if (!clean) removed.push({ field: "booleanSearchStrings", value: s, reason: "protected attribute" });
      return clean;
    }),
  };
  return { draft: cleaned, removed };
}
