import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const SECTIONS = [
  { id: "acceptance", label: "Acceptance" },
  { id: "the-service", label: "The service" },
  { id: "accounts", label: "Accounts & guest access" },
  { id: "acceptable-use", label: "Acceptable use" },
  { id: "ai-limitations", label: "AI limitations" },
  { id: "availability", label: "Availability" },
  { id: "changes", label: "Changes" },
  { id: "contact", label: "Contact" },
];

export function Terms() {
  return (
    <div className="h-[var(--app-vh)] overflow-y-auto bg-[var(--aurora-bg)] text-[var(--aurora-text)]">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        <Link
          to="/welcome"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--aurora-text-secondary)] hover:text-[var(--aurora-text)]"
        >
          <ArrowLeft size={14} /> Back
        </Link>

        <h1 className="mt-6 text-3xl font-semibold text-[var(--aurora-text)]">Terms of Service</h1>
        <p className="mt-2 text-sm text-[var(--aurora-text-muted)]">Last updated: September 10, 2026</p>

        <div className="mt-4 rounded-xl border border-[var(--aurora-warning)]/30 bg-[var(--aurora-warning)]/5 p-4 text-xs leading-relaxed text-[var(--aurora-text-secondary)]">
          This is a plain-language description of how JennySol may be used, provided as a
          placeholder. It has <strong className="text-[var(--aurora-text)]">not</strong> been reviewed or
          finalized by legal counsel.
        </div>

        <nav className="mt-8 rounded-xl border border-[var(--aurora-border)] bg-[var(--aurora-surface)]/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--aurora-text-muted)]">On this page</p>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-sm text-[var(--aurora-indigo)] hover:underline">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <article className="prose prose-invert prose-sm mt-10 max-w-none prose-headings:font-semibold prose-headings:text-[var(--aurora-text)] prose-p:text-[var(--aurora-text-secondary)] prose-li:text-[var(--aurora-text-secondary)] prose-strong:text-[var(--aurora-text)]">
          <h2 id="acceptance">Acceptance</h2>
          <p>By using JennySol, you agree to these terms.</p>

          <h2 id="the-service">The service</h2>
          <p>
            JennySol is an AI chat assistant built by Vikisol Labs, offering conversational chat,
            document-grounded question answering, voice interaction, live web search (when
            configured), and image generation (subject to provider availability).
          </p>

          <h2 id="accounts">Accounts &amp; guest access</h2>
          <p>
            You can use JennySol immediately as a guest, without creating an account, up to a
            limited number of messages. Creating a full account with an email and password (or
            Google sign-in) removes that limit and lets you return to your conversations from any
            device.
          </p>

          <h2 id="acceptable-use">Acceptable use</h2>
          <ul>
            <li>Don't use JennySol to generate content that is illegal, harmful, or infringes on others' rights.</li>
            <li>Don't attempt to circumvent rate limits, guest limits, or access another user's account or data.</li>
            <li>Don't upload documents you don't have the right to share.</li>
          </ul>

          <h2 id="ai-limitations">AI limitations &amp; responsible use</h2>
          <p>
            JennySol is an AI system and can make mistakes. For questions that require current,
            real-world accuracy, JennySol uses live search where possible and will tell you plainly
            when it can't verify something rather than guess — but you should still independently
            verify anything important (medical, legal, financial, or safety-critical information)
            before relying on it.
          </p>

          <h2 id="availability">Availability</h2>
          <p>
            Some capabilities (such as image generation or live search) depend on third-party
            providers and their available quota, and may be temporarily unavailable. We aim to be
            transparent in the product about what's actually working at any given time rather than
            silently failing.
          </p>

          <h2 id="changes">Changes to these terms</h2>
          <p>We may update these terms as the product changes. The "last updated" date above reflects the most recent revision.</p>

          <h2 id="contact">Contact</h2>
          <p>Questions about these terms can be directed to Vikisol Technologies.</p>
        </article>
      </div>
    </div>
  );
}
