// Workflow (b): a question comes back as a short report whose sentences point
// at the search hits that support them. No hits means no report.

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface CitedReport {
  report: string;
  citations: Array<{ n: number; title: string; url: string }>;
  note: string;
}

export function citedReport(question: string, hits: SearchHit[]): CitedReport {
  const usable = hits.filter((hit) => hit.url && hit.snippet);
  if (usable.length === 0) {
    return {
      report: "",
      citations: [],
      note: `No sources were found for "${question.trim()}", so there is no report.`,
    };
  }
  const citations = usable.map((hit, index) => ({ n: index + 1, title: hit.title || hit.url, url: hit.url }));
  const report = usable.map((hit, index) => `${hit.snippet.trim()} [${index + 1}]`).join("\n");
  return { report, citations, note: "" };
}
