import { z } from "zod";

// Every extracted item is either a real phrase pulled from the JD, or the literal string
// "unknown" — never guessed. The model is told this in the prompt; this schema only enforces
// shape, not truthfulness, so scorecardEval.ts's field-accuracy check exists separately.
const citedItem = z.object({
  value: z.string().min(1),
  quote: z.string().min(1).describe("The exact phrase in the JD this came from, or 'unknown' if not stated."),
});

export const agencyScorecardDraftSchema = z.object({
  role: z.string().min(1),
  mustHave: z.array(citedItem),
  niceToHave: z.array(citedItem),
  experienceRange: citedItem,
  locationOrWorkMode: citedItem,
  compensation: citedItem,
  noticePeriod: citedItem,
  disqualifiers: z.array(citedItem),
  contradictions: z.array(z.string()),
  missingInformation: z.array(z.string()),
  clientClarificationQuestions: z.array(z.string()),
  screeningQuestions: z.array(z.string()),
  booleanSearchStrings: z.array(z.string()),
});

export type AgencyScorecardDraft = z.infer<typeof agencyScorecardDraftSchema>;

export type CitedItem = z.infer<typeof citedItem>;
