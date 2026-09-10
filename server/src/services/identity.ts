// Canonical, deterministic product/company identity — the single source of
// truth for "who created JennySol" style questions, answered WITHOUT ever
// calling a model. This has to be 100% consistent and correct regardless of
// which provider is selected (Gemini/DeepSeek/Ollama), regardless of
// whether search/grounding is available, and regardless of a small local
// model's instruction-following reliability. Live production testing
// showed the same near-identical question answered three different,
// mutually-contradictory, entirely fabricated ways ("the folks at Solv",
// "created by Dave", "developed by Google") across three requests — putting
// this fact only in the system prompt and hoping every model surfaces it
// verbatim, every time, isn't reliable enough given that. A deterministic
// short-circuit in chatRunner.ts (see isIdentityQuestion's caller) can't
// hallucinate, can't invent extra biography, and can't say "I don't know."
export const JENNYSOL_IDENTITY = {
  productName: "JennySol",
  organization: "Vikisol Labs",
  founder: "Syam Prabhakar Seeli",
  founderLineage: "son of the late Kishore Seeli, a great visionary leader",
} as const;

export const CANONICAL_IDENTITY_RESPONSE =
  `I was created at ${JENNYSOL_IDENTITY.organization} by my founder, ${JENNYSOL_IDENTITY.founder} — ${JENNYSOL_IDENTITY.founderLineage}.`;

// Deliberately several explicit patterns rather than one dense regex —
// easier to verify each phrasing independently, and to extend later
// without fighting alternation precedence bugs. The subject/verb/role
// alternations below are the "normalized intent" part: any combination of
// them matches, so a new phrasing built from the same building blocks
// (e.g. "Who's the maker of Vikisol Labs?") doesn't need its own entry.
const IDENTITY_SUBJECT = "(?:you|me|jennysol|vikisol\\s+labs|vikisol)";
const IDENTITY_VERB = "(?:created|creates|made|founded|developed|develops|built|builds|building)";
const IDENTITY_ROLE = "(?:founder|founders|creator|maker)";

const IDENTITY_PATTERNS: RegExp[] = [
  // "you/me/jennysol/vikisol(\slabs)?" — first-person phrasing ("who
  // created me?") is a real, confirmed production miss: a user asking
  // about themselves in third person still means "who created this
  // assistant," not literally "who created the human typing this."
  new RegExp(`\\bwho\\s+${IDENTITY_VERB}\\s+${IDENTITY_SUBJECT}\\b`, "i"),
  new RegExp(`\\bwho\\s+is\\s+(?:your|my|jennysol'?s|vikisol\\s+labs'?|vikisol'?s)\\s+${IDENTITY_ROLE}\\b`, "i"),
  new RegExp(`\\bwho'?s\\s+(?:your|my|jennysol'?s|vikisol\\s+labs'?|vikisol'?s)\\s+${IDENTITY_ROLE}\\b`, "i"),
  // The "of"-form: "who's the maker of Vikisol Labs" / "who is the founder
  // of JennySol" — a different grammar from the possessive form above, not
  // covered by it.
  new RegExp(`\\bwho\\s+is\\s+the\\s+${IDENTITY_ROLE}\\s+of\\s+${IDENTITY_SUBJECT}\\b`, "i"),
  new RegExp(`\\bwho'?s\\s+the\\s+${IDENTITY_ROLE}\\s+of\\s+${IDENTITY_SUBJECT}\\b`, "i"),
  new RegExp(`\\bwho\\s+is\\s+behind\\s+(?:you|jennysol|vikisol(?:\\s+labs)?|this)\\b`, "i"),
  new RegExp(`\\bwho'?s\\s+behind\\s+(?:you|jennysol|vikisol(?:\\s+labs)?|this)\\b`, "i"),
  new RegExp(`\\bwhere\\s+(?:was|were)\\s+(?:you|jennysol)\\s+${IDENTITY_VERB}\\b`, "i"),
];

// "Who is <name>?" for a name that's actually a known part of JennySol's
// own canonical identity (the founder) — distinct from "who created you"
// above: this is a direct lookup against a known entity, the same idiom
// dateTime.ts uses for city names, not an open-ended person-recognition
// system. A name not in this list (e.g. "Who is the current Queen of
// Thailand?") correctly falls through to the model, unaffected.
const KNOWN_IDENTITY_ENTITIES = new Set([
  "syam prabhakar seeli",
  "syam seeli",
  "syam prabhakar",
  "kishore seeli",
]);
const NAME_LOOKUP_PATTERN = /\bwho\s+is\s+([a-z][a-z\s.'-]*?)\s*[?!.]*\s*$/i;

export function isIdentityQuestion(message: string): boolean {
  if (IDENTITY_PATTERNS.some((pattern) => pattern.test(message))) return true;
  const nameMatch = message.match(NAME_LOOKUP_PATTERN);
  if (!nameMatch) return false;
  const name = nameMatch[1].toLowerCase().trim().replace(/\s+/g, " ");
  return KNOWN_IDENTITY_ENTITIES.has(name);
}
