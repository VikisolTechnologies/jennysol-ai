// Workflow (c) for JennySol v1 is the Agency Desk scorecard, not a developer
// sandbox. A recruiter pastes a requirement. Jenny drafts a scorecard and a
// search strategy. The recruiter decides. Nothing here contacts a candidate,
// scrapes a site, or writes to an ATS.

export interface AgencyScorecard {
  role: string;
  mustHave: string[];
  niceToHave: string[];
  searchStrategy: string[];
  recruiterDecides: true;
}

function linesAfter(text: string, label: RegExp): string[] {
  const match = text.split(/\n/).find((line) => label.test(line));
  if (!match) return [];
  return match
    .replace(label, "")
    .split(/[;,•]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function draftAgencyScorecard(requirement: string): AgencyScorecard {
  const trimmed = requirement.trim();
  const firstLine = trimmed.split("\n")[0]?.trim() || "Untitled role";
  const mustHave = linesAfter(trimmed, /must[- ]have:?/i);
  const niceToHave = linesAfter(trimmed, /nice[- ]to[- ]have:?/i);
  return {
    role: firstLine.slice(0, 160),
    mustHave: mustHave.length > 0 ? mustHave : ["Confirm the must-have skills with the hiring manager"],
    niceToHave,
    searchStrategy: [
      "Search the agency's own database before any new sourcing",
      "Match on the must-have skills and the stated location or remote rule",
      "Do not rank on names, photos, or protected attributes",
      "Bring the shortlist back for the recruiter to accept, edit, or reject",
    ],
    recruiterDecides: true,
  };
}
