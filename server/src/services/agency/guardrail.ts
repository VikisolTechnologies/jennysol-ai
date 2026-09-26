import type { AgencyScorecardDraft, CitedItem } from "./scorecardSchema.js";

// Founder Outreach Pack §"Data and candidate protections" / ADR-007 §9 / docs/evals/
// agency-scorecard-eval-set.md rules 7-9: names, photographs, and protected personal
// characteristics are never used as ranking signals. This is the enforcement point — any
// criterion the model drafted that names one of these gets stripped before the recruiter ever
// sees it as a "must-have"/"nice-to-have"/"disqualifier"/search string, not just discouraged in
// the prompt. Deliberately broad and case-insensitive: a false positive (stripping something
// borderline) is the safe failure mode here, a false negative is not.
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
  // The original JD phrase this came from — eval rule 8: "Preserve questionable instructions in
  // the audit trail while clearly refusing to apply them." Never dropped, even though it's never
  // used to rank/shortlist/reject anyone.
  quote: string;
  reason: string;
}

function isClean(item: CitedItem): boolean {
  return !PROTECTED_PATTERNS.some(({ pattern }) => pattern.test(item.value) || pattern.test(item.quote));
}

function reasonFor(text: string): string {
  const hit = PROTECTED_PATTERNS.find(({ pattern }) => pattern.test(text));
  return hit ? hit.label : "protected attribute";
}

function filterList(field: string, items: CitedItem[], removed: GuardrailRemoval[]): CitedItem[] {
  const kept: CitedItem[] = [];
  for (const item of items) {
    if (isClean(item)) {
      kept.push(item);
    } else {
      removed.push({ field, value: item.value, quote: item.quote, reason: reasonFor(`${item.value} ${item.quote}`) });
    }
  }
  return kept;
}

// docs/evals/agency-scorecard-eval-set.md's own expected wording (cases 8 and 10) — generic
// enough to cover any of PROTECTED_PATTERNS' labels, not a per-case lookup table. Eval pass
// criteria (bottom of that doc) are about the BEHAVIOR this produces (never silent, always
// escalated, no proxy, no automated matching) rather than requiring this exact sentence.
function refusalNoticeFor(removed: GuardrailRemoval[]): string {
  const labels = [...new Set(removed.map((r) => r.reason))];
  const quotes = [...new Set(removed.map((r) => `"${r.quote}"`))].join(", ");
  return (
    `The JD contains a requirement based on a protected attribute (${labels.join(", ")}): ${quotes}. ` +
    `JennySol will not use ${labels.join(" or ")} — or any inferred proxy for it — to search, rank, shortlist, include, exclude or reject candidates. ` +
    `This requires recruiter/compliance review. Ask the client to replace this condition with job-related criteria instead. ` +
    `The legitimate parts of this requirement are still extracted below; automated matching should not proceed until this is acknowledged.`
  );
}

export interface GuardrailResult {
  draft: AgencyScorecardDraft;
  removed: GuardrailRemoval[];
  // eval rule 9: "Recommend recruiter or compliance review when a requirement may be
  // discriminatory" — true whenever anything was stripped, never silently.
  escalate: boolean;
  refusalNotice?: string;
}

// Runs after the model draft parses successfully, before persistence — a caller never sees an
// unfiltered draft. Returns what was removed so the caller (and the eval) can prove leakage is 0,
// not just assert it.
export function applyGuardrail(draft: AgencyScorecardDraft): GuardrailResult {
  const removed: GuardrailRemoval[] = [];
  const cleaned: AgencyScorecardDraft = {
    ...draft,
    mustHave: filterList("mustHave", draft.mustHave, removed),
    niceToHave: filterList("niceToHave", draft.niceToHave, removed),
    disqualifiers: filterList("disqualifiers", draft.disqualifiers, removed),
    booleanSearchStrings: draft.booleanSearchStrings.filter((s) => {
      const clean = !PROTECTED_PATTERNS.some(({ pattern }) => pattern.test(s));
      if (!clean) removed.push({ field: "booleanSearchStrings", value: s, quote: s, reason: reasonFor(s) });
      return clean;
    }),
  };
  return {
    draft: cleaned,
    removed,
    escalate: removed.length > 0,
    refusalNotice: removed.length > 0 ? refusalNoticeFor(removed) : undefined,
  };
}
