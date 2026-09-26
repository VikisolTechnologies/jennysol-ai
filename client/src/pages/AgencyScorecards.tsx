import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { authFetch } from "../lib/auth";

interface CitedItem {
  value: string;
  quote: string;
}

interface ScorecardDraft {
  role: string;
  mustHave: CitedItem[];
  niceToHave: CitedItem[];
  experienceRange: CitedItem;
  locationOrWorkMode: CitedItem;
  compensation: CitedItem;
  noticePeriod: CitedItem;
  disqualifiers: CitedItem[];
  contradictions: string[];
  missingInformation: string[];
  clientClarificationQuestions: string[];
  screeningQuestions: string[];
  booleanSearchStrings: string[];
}

interface GuardrailRemoval {
  field: string;
  value: string;
  quote: string;
  reason: string;
}

interface Scorecard {
  id: string;
  status: "draft" | "approved";
  version: number;
  scorecard: ScorecardDraft;
  guardrailRemoved: GuardrailRemoval[];
  requiresReview: boolean;
  refusalNotice: string | null;
}

interface Tenant {
  id: string;
  name: string;
  dataProcessingSetting: "private_only" | "private_plus_controlled_cloud";
  cloudProcessingDisabled: boolean;
}

function CitedList({ items }: { items: CitedItem[] }) {
  if (items.length === 0) return <p className="text-sm text-[#8b8b93]">unknown</p>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, i) => (
        <li key={i} className="text-sm">
          {item.value}
          <span className="ml-1.5 text-xs text-[#8b8b93]">"{item.quote}"</span>
        </li>
      ))}
    </ul>
  );
}

function StringList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-sm text-[#8b8b93]">none</p>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, i) => (
        <li key={i} className="text-sm">
          {item}
        </li>
      ))}
    </ul>
  );
}

// "value :: quote" per line — a plain, typeable format for a mobile textarea rather than a
// per-field form for two array fields; matches what editDraft on the server expects to receive.
function parseCitedLines(text: string): CitedItem[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [value, quote] = line.split("::").map((s) => s.trim());
      return { value: value || line, quote: quote || value || line };
    });
}

function citedLinesText(items: CitedItem[]): string {
  return items.map((item) => `${item.value} :: ${item.quote}`).join("\n");
}

export function AgencyScorecards() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [newTenantName, setNewTenantName] = useState("");
  const [requirement, setRequirement] = useState("");
  const [scorecards, setScorecards] = useState<Scorecard[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMustHave, setEditMustHave] = useState("");
  const [editNiceToHave, setEditNiceToHave] = useState("");
  const [editCompensation, setEditCompensation] = useState("");
  const [editNoticePeriod, setEditNoticePeriod] = useState("");
  const [reviewChecked, setReviewChecked] = useState<Record<string, boolean>>({});

  async function loadTenants() {
    const res = await authFetch("/api/agency/tenants");
    if (!res.ok) return;
    const body = (await res.json()) as { tenants: Tenant[] };
    setTenants(body.tenants);
    if (body.tenants.length > 0) setTenantId((current) => current ?? body.tenants[0].id);
  }

  async function createTenant(event: FormEvent) {
    event.preventDefault();
    if (!newTenantName.trim()) return;
    const res = await authFetch("/api/agency/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTenantName }),
    });
    if (!res.ok) {
      setError("Couldn't create that agency.");
      return;
    }
    setNewTenantName("");
    await loadTenants();
  }

  async function load() {
    if (!tenantId) return;
    const res = await authFetch(`/api/agency/scorecards?tenantId=${tenantId}`);
    if (!res.ok) return;
    const body = (await res.json()) as { scorecards: Scorecard[] };
    setScorecards(body.scorecards);
  }

  useEffect(() => {
    void loadTenants();
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const activeTenant = tenants.find((t) => t.id === tenantId);
  const cloudReady = activeTenant?.dataProcessingSetting === "private_plus_controlled_cloud" && !activeTenant.cloudProcessingDisabled;

  async function draft(event: FormEvent) {
    event.preventDefault();
    if (!requirement.trim() || !tenantId) return;
    setBusy(true);
    setError("");
    const res = await authFetch("/api/agency/scorecards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, requirement }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Couldn't draft a scorecard.");
      return;
    }
    setRequirement("");
    await load();
  }

  function startEdit(card: Scorecard) {
    setEditingId(card.id);
    setEditMustHave(citedLinesText(card.scorecard.mustHave));
    setEditNiceToHave(citedLinesText(card.scorecard.niceToHave));
    setEditCompensation(card.scorecard.compensation.value);
    setEditNoticePeriod(card.scorecard.noticePeriod.value);
  }

  async function saveEdit(id: string) {
    const res = await authFetch(`/api/agency/scorecards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        mustHave: parseCitedLines(editMustHave),
        niceToHave: parseCitedLines(editNiceToHave),
        compensation: { value: editCompensation, quote: editCompensation },
        noticePeriod: { value: editNoticePeriod, quote: editNoticePeriod },
      }),
    });
    if (!res.ok) {
      setError("Couldn't save that edit.");
      return;
    }
    setEditingId(null);
    await load();
  }

  async function approve(id: string, reviewed: boolean) {
    const res = await authFetch(`/api/agency/scorecards/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, reviewed }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Couldn't approve that scorecard.");
      return;
    }
    await load();
  }

  return (
    <div className="h-[var(--app-vh)] overflow-y-auto bg-[#09090b] text-[#f2f2f3]">
      <div className="mx-auto max-w-xl px-4 py-8">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-[#8b8b93]">
          <ArrowLeft size={14} /> Back to chat
        </Link>
        <h1 className="mt-6 text-xl font-semibold">Agency scorecards</h1>
        <p className="mt-1 text-sm text-[#8b8b93]">
          Paste a job requirement. Jenny drafts a scorecard — every field cited to the JD, nothing guessed. You decide what's approved.
        </p>

        {tenants.length === 0 ? (
          <form onSubmit={createTenant} className="mt-6 flex flex-col gap-2 rounded-2xl border border-[#232326] bg-[#141416] p-4">
            <p className="text-sm">Name your agency to get started.</p>
            <div className="flex gap-2">
              <input
                value={newTenantName}
                onChange={(e) => setNewTenantName(e.target.value)}
                placeholder="Agency name"
                className="min-w-0 flex-1 rounded-full border border-[#232326] bg-[#0d0d0e] px-4 py-2 text-sm"
              />
              <button type="submit" disabled={!newTenantName.trim()} className="rounded-full bg-[#ff6b35] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                Create
              </button>
            </div>
          </form>
        ) : (
          <>
            {tenants.length > 1 && (
              <select
                value={tenantId ?? ""}
                onChange={(e) => setTenantId(e.target.value)}
                className="mt-4 w-full rounded-full border border-[#232326] bg-[#141416] px-4 py-2 text-sm"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}

            {!cloudReady && (
              <p className="mt-4 rounded-2xl border border-[#232326] bg-[#141416] px-4 py-3 text-sm text-[#8b8b93]">
                Cloud drafting isn't enabled for {activeTenant?.name} yet — it defaults to private-only processing
                (ADR-007) until that's explicitly turned on. Ask the founder to opt this agency in.
              </p>
            )}

            <form onSubmit={draft} className="mt-4 flex flex-col gap-2">
              <textarea
                value={requirement}
                onChange={(event) => setRequirement(event.target.value)}
                placeholder="Paste the client's job requirement here…"
                rows={6}
                className="w-full rounded-2xl border border-[#232326] bg-[#141416] px-4 py-3 text-sm"
              />
              <button
                type="submit"
                disabled={busy || !requirement.trim() || !cloudReady}
                className="self-start rounded-full bg-[#ff6b35] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy ? "Drafting…" : "Draft scorecard"}
              </button>
            </form>
          </>
        )}
        {error && <p className="mt-3 text-sm text-[#e5534b]">{error}</p>}

        {tenants.length > 0 && scorecards.length === 0 && !error && (
          <p className="mt-8 rounded-2xl border border-dashed border-[#232326] px-4 py-5 text-sm text-[#8b8b93]">
            No scorecards yet. Paste a requirement above to draft one.
          </p>
        )}

        <div className="mt-6 flex flex-col gap-4">
          {scorecards.map((card) => {
            const { id, status, version, scorecard, guardrailRemoved, requiresReview, refusalNotice } = card;
            return (
              <article key={id} className="rounded-2xl border border-[#232326] bg-[#141416] p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-sm font-semibold">{scorecard.role}</h2>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      status === "approved" ? "bg-[#3fb950]/15 text-[#3fb950]" : "bg-[#ff6b35]/15 text-[#ff8a5b]"
                    }`}
                  >
                    {status} · v{version}
                  </span>
                </div>

                {requiresReview && (
                  <div className="mt-3 rounded-xl border border-[#e5534b]/40 bg-[#e5534b]/10 p-3 text-sm text-[#ff9a94]">
                    <p className="font-semibold">Needs recruiter/compliance review</p>
                    <p className="mt-1 text-xs">{refusalNotice}</p>
                  </div>
                )}

                <div className="mt-3 flex flex-col gap-3 text-sm">
                  {editingId === id ? (
                    <>
                      <div>
                        <p className="text-xs font-semibold text-[#8b8b93]">Must-have (one per line: value :: quote)</p>
                        <textarea
                          value={editMustHave}
                          onChange={(e) => setEditMustHave(e.target.value)}
                          rows={3}
                          className="w-full rounded-lg border border-[#232326] bg-[#0d0d0e] px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-[#8b8b93]">Nice-to-have (one per line: value :: quote)</p>
                        <textarea
                          value={editNiceToHave}
                          onChange={(e) => setEditNiceToHave(e.target.value)}
                          rows={2}
                          className="w-full rounded-lg border border-[#232326] bg-[#0d0d0e] px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={editCompensation}
                          onChange={(e) => setEditCompensation(e.target.value)}
                          placeholder="Compensation"
                          className="min-w-0 flex-1 rounded-lg border border-[#232326] bg-[#0d0d0e] px-3 py-2 text-sm"
                        />
                        <input
                          value={editNoticePeriod}
                          onChange={(e) => setEditNoticePeriod(e.target.value)}
                          placeholder="Notice period"
                          className="min-w-0 flex-1 rounded-lg border border-[#232326] bg-[#0d0d0e] px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void saveEdit(id)}
                          className="rounded-full bg-[#ff6b35] px-4 py-1.5 text-xs font-semibold text-white"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-full border border-[#232326] px-4 py-1.5 text-xs font-semibold text-[#8b8b93]"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <p className="text-xs font-semibold text-[#8b8b93]">Must-have</p>
                        <CitedList items={scorecard.mustHave} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-[#8b8b93]">Nice-to-have</p>
                        <CitedList items={scorecard.niceToHave} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-[#8b8b93]">Experience / location / compensation / notice</p>
                        <CitedList
                          items={[scorecard.experienceRange, scorecard.locationOrWorkMode, scorecard.compensation, scorecard.noticePeriod]}
                        />
                      </div>
                    </>
                  )}
                  {scorecard.contradictions.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-[#e5534b]">Contradictions</p>
                      <StringList items={scorecard.contradictions} />
                    </div>
                  )}
                  {scorecard.missingInformation.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-[#8b8b93]">Missing — ask the client</p>
                      <StringList items={scorecard.missingInformation} />
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-[#8b8b93]">Client clarification questions</p>
                    <StringList items={scorecard.clientClarificationQuestions} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#8b8b93]">Screening questions</p>
                    <StringList items={scorecard.screeningQuestions} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#8b8b93]">Boolean search strings</p>
                    <StringList items={scorecard.booleanSearchStrings} />
                  </div>
                  {guardrailRemoved.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-[#8b8b93]">Removed before you saw this (protected attributes)</p>
                      <StringList items={guardrailRemoved.map((r) => `"${r.quote}" (${r.reason})`)} />
                    </div>
                  )}
                </div>

                {status === "draft" && editingId !== id && (
                  <div className="mt-4 flex flex-col gap-2">
                    {requiresReview && (
                      <label className="flex items-center gap-2 text-xs text-[#8b8b93]">
                        <input
                          type="checkbox"
                          checked={!!reviewChecked[id]}
                          onChange={(e) => setReviewChecked((prev) => ({ ...prev, [id]: e.target.checked }))}
                        />
                        I've reviewed the flagged requirement above
                      </label>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(card)}
                        className="rounded-full border border-[#232326] px-4 py-2 text-xs font-semibold text-[#f2f2f3]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void approve(id, requiresReview)}
                        disabled={requiresReview && !reviewChecked[id]}
                        className="rounded-full bg-[#3fb950] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
