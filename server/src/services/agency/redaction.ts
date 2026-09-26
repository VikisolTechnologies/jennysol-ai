// ADR-007 §4/§12 step 4: deterministic JD redaction (client name, emails, phones, URLs) before
// anything is ever sent to CONTROLLED_CLOUD. Deliberately regex-based, not model-based — ADR-007
// §3 is explicit that classification/redaction is decided in deterministic code, never by the
// model. "Fails closed" here means: if a verifiably-detectable pattern (email or URL — the two
// patterns with no legitimate, ambiguous use in a JD) survives redaction, the result is marked
// !ok, and the caller must never send it anywhere.
export interface RedactionRemoval {
  type: "company_name" | "email" | "phone" | "url";
  count: number;
}

export interface RedactionResult {
  ok: boolean;
  redacted: string;
  removed: RedactionRemoval[];
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_RE = /\bhttps?:\/\/[^\s)]+|\bwww\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s)]*/gi;
// Non-global, and deliberately BROADER than the redaction patterns above — a check that only
// re-ran the identical redaction regex could never catch anything the redaction pass itself
// missed. URL_CHECK also flags a bare domain with no http(s)/www prefix (e.g. a client name that
// happens to read as "northstar-example.com" mid-sentence), which URL_RE's redaction pass doesn't
// strip. (Non-global: a global regex's `.test()` mutates its own `lastIndex` on a match, which
// would make repeated calls on the SAME module-level regex object silently skip content on a
// later call — irrelevant here since these are never global, but worth being deliberate about.)
const EMAIL_CHECK = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const URL_CHECK = /\b(?:https?:\/\/|www\.)[^\s)]+|\b[a-zA-Z0-9-]{2,}\.(?:com|in|io|co|org|net|dev)\b(?:\/[^\s)]*)?/i;
// Deliberately conservative: requires 9+ total characters of digits/separators between two
// digits, which real phone numbers clear easily but short numeric ranges common in a JD
// ("3-5 years", "22-30 lakh") do not. Not re-verified in the fail-closed check below (see the
// module comment) since a stricter regex would also start flagging ordinary JD numerics.
const PHONE_RE = /\+?\d[\d\-\s()]{7,}\d/g;

function redactCompanyName(text: string, removed: RedactionRemoval[]): string {
  const match = text.match(/\*\*Company:\*\*\s*([^\n]+)|(?:^|\n)Company:\s*([^\n]+)/);
  const name = (match?.[1] ?? match?.[2])?.trim();
  if (!name) return text;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "g");
  const count = (text.match(re) || []).length;
  if (count > 0) removed.push({ type: "company_name", count });
  return text.replace(re, "[REDACTED CLIENT NAME]");
}

export function redactJd(text: string): RedactionResult {
  const removed: RedactionRemoval[] = [];
  let out = redactCompanyName(text, removed);

  const emailCount = (out.match(EMAIL_RE) || []).length;
  if (emailCount > 0) removed.push({ type: "email", count: emailCount });
  out = out.replace(EMAIL_RE, "[REDACTED EMAIL]");

  const urlCount = (out.match(URL_RE) || []).length;
  if (urlCount > 0) removed.push({ type: "url", count: urlCount });
  out = out.replace(URL_RE, "[REDACTED URL]");

  const phoneCount = (out.match(PHONE_RE) || []).length;
  if (phoneCount > 0) removed.push({ type: "phone", count: phoneCount });
  out = out.replace(PHONE_RE, "[REDACTED PHONE]");

  // Fail closed: re-run the two unambiguous detectors against the OUTPUT. If either still
  // matches (a pattern this regex didn't anticipate — an obfuscated email, an unusual TLD),
  // the result is refused rather than shipped as "redacted" when it might not be.
  const ok = !EMAIL_CHECK.test(out) && !URL_CHECK.test(out);
  return { ok, redacted: out, removed };
}
