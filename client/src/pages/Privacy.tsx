import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "data-we-store", label: "What we store" },
  { id: "conversations", label: "Conversations & memory" },
  { id: "files", label: "Files" },
  { id: "voice", label: "Voice processing" },
  { id: "search", label: "Search & third parties" },
  { id: "retention", label: "Retention & deletion" },
  { id: "security", label: "Security" },
  { id: "contact", label: "Contact" },
];

// Written to describe what this app's code actually does today, not a
// generic template — kept in sync with server/src/services/auth,
// conversationStore.ts, vectorStore.ts, and the search/weather/voice
// pipelines. Marked for legal review below rather than presented as
// legally finalized language, per this task's explicit instruction not to
// fabricate compliance claims (GDPR/SOC2/HIPAA/etc. are not asserted here
// because they haven't been certified).
export function Privacy() {
  return (
    <div className="h-[var(--app-vh)] overflow-y-auto bg-[var(--aurora-bg)] text-[var(--aurora-text)]">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        <Link
          to="/welcome"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--aurora-text-secondary)] hover:text-[var(--aurora-text)]"
        >
          <ArrowLeft size={14} /> Back
        </Link>

        <h1 className="mt-6 text-3xl font-semibold text-[var(--aurora-text)]">Privacy Policy</h1>
        <p className="mt-2 text-sm text-[var(--aurora-text-muted)]">Last updated: September 10, 2026</p>

        <div className="mt-4 rounded-xl border border-[var(--aurora-warning)]/30 bg-[var(--aurora-warning)]/5 p-4 text-xs leading-relaxed text-[var(--aurora-text-secondary)]">
          This page describes what JennySol's software actually does today, in plain language. It is{" "}
          <strong className="text-[var(--aurora-text)]">not</strong> a substitute for formal legal review —
          language marked below as needing review has not been finalized by counsel.
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
          <h2 id="overview">Overview</h2>
          <p>
            JennySol is an AI chat application built by Vikisol Labs. This page explains what data
            the application stores, why, and what you can do about it.
          </p>

          <h2 id="data-we-store">What we store</h2>
          <ul>
            <li>Account information: email address, display name, and a securely hashed password (we never store your password in plain text).</li>
            <li>If you sign in with Google: your Google account's email and name, used only to create or match your JennySol account.</li>
            <li>Session information: which devices/browsers are currently signed in, so you can review and revoke them.</li>
            <li>Your conversations with JennySol, and any files you upload, tied to your account.</li>
          </ul>

          <h2 id="conversations">Conversations &amp; memory</h2>
          <p>
            Your conversation history is stored so you can return to past chats. JennySol does not
            currently maintain a separate long-term memory that extracts and recalls facts about you
            across different conversations — what exists today is your conversation history itself.
          </p>

          <h2 id="files">Files</h2>
          <p>
            Documents you upload are processed to let JennySol answer questions grounded in their
            content. Files are scoped to your account; other users cannot access them.
          </p>

          <h2 id="voice">Voice processing</h2>
          <p>
            Voice input is transcribed using your browser's built-in speech recognition, which may
            process audio through your browser vendor's own service depending on the browser — this
            is outside JennySol's direct control. Spoken responses are generated on request and are
            not stored as audio after playback.
          </p>

          <h2 id="search">Search &amp; third parties</h2>
          <p>
            When a question needs current information, JennySol sends the search query (not your
            full conversation) to a third-party search provider to retrieve live results. We use
            Tavily for this when configured. No provider API keys are ever exposed to your browser.
          </p>

          <h2 id="retention">Retention &amp; deletion</h2>
          <p>
            <strong>Marked for legal review:</strong> a formal data retention schedule and a
            self-service account/data deletion flow are not yet implemented in the product. If you
            want your account and data removed today, contact us directly (see below) and we will
            handle it manually.
          </p>

          <h2 id="security">Security</h2>
          <p>
            Passwords are hashed, sessions are revocable individually or all at once, and a password
            reset immediately invalidates every other active session. We do not claim any third-party
            security certification (such as SOC 2 or ISO 27001) — none has been obtained.
          </p>

          <h2 id="contact">Contact</h2>
          <p>For any privacy question or a data deletion request, contact Vikisol Technologies directly.</p>
        </article>
      </div>
    </div>
  );
}
