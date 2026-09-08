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
// without fighting alternation precedence bugs.
const IDENTITY_PATTERNS: RegExp[] = [
  // "you/me/jennysol" — first-person phrasing ("who created me?") is a real,
  // confirmed production miss: a user asking about themselves in third
  // person still means "who created this assistant," not literally "who
  // created the human typing this."
  /\bwho\s+(created|creates|made|founded|developed|built)\s+(you|me|jennysol)\b/i,
  /\bwho\s+is\s+(your|my|jennysol'?s)\s+(founder|creator|maker)\b/i,
  /\bwho'?s\s+(your|my|jennysol'?s)\s+(founder|creator|maker)\b/i,
  /\bwho\s+is\s+behind\s+(you|jennysol|this)\b/i,
  /\bwho'?s\s+behind\s+(you|jennysol|this)\b/i,
  /\bwhere\s+(was|were)\s+(you|jennysol)\s+(created|made|built|developed|founded)\b/i,
];

export function isIdentityQuestion(message: string): boolean {
  return IDENTITY_PATTERNS.some((pattern) => pattern.test(message));
}
