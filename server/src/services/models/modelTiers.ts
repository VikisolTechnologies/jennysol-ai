// Difficulty tiers for providers that offer several model sizes (Claude today - see
// providers/anthropic.ts). The goal is cost-proportional quality: most requests ("find me a
// badminton game tonight") are everyday and go to the fastest, cheapest model; only a request
// that genuinely needs planning pays for the strongest one.
//
// Deliberately a cheap, deterministic heuristic rather than an extra model call to classify -
// classifying with a model would add latency and cost to every single request to save cost on a
// few. Errs upward when unsure: a "balanced" answer to a simple question costs little, a "fast"
// answer to a real planning request fails the user.

export type DifficultyTier = "fast" | "balanced" | "deep";

// Asking for a plan, or for several things to happen in sequence.
const PLANNING =
  /\b(plan|planning|organi[sz]e|arrange|set up|schedule|itinerary|step[ -]by[ -]step|and then|after that|first\b.*\bthen|help me (get|start|build|run|launch))\b/i;

// Asking for judgement over results, or for something to be written.
const JUDGEMENT =
  /\b(compare|better|best|worth|recommend|suggest|should i|pros and cons|summari[sz]e|draft|write|rewrite|explain|why)\b|\bwhich\b.*\b(one|pick|choose)\b/i;

// Distinct kinds of action a single request can ask for - two or more means a multi-step task.
const ACTIONS: RegExp[] = [
  /\b(post|share|announce)\b/i,
  /\b(start|create|host|organi[sz]e)\b/i,
  /\b(find|search|look for|show me|any)\b/i,
  /\b(apply|job|role|hiring)\b/i,
  /\b(bid|project|freelanc|build me|get .* built)\b/i,
  /\b(join|sign me up|count me in)\b/i,
  /\b(message|dm|ask .* directly|reach out)\b/i,
  /\b(community|group)\b/i,
];

export function classifyDifficulty(message: string, priorTurns = 0): DifficultyTier {
  const text = message.trim();
  const actionKinds = ACTIONS.filter((re) => re.test(text)).length;

  if (PLANNING.test(text) || actionKinds >= 3 || text.length > 400) return "deep";
  if (JUDGEMENT.test(text) || actionKinds === 2 || text.length > 160 || priorTurns >= 8) return "balanced";
  return "fast";
}
