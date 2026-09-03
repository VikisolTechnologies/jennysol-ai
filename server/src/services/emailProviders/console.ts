import type { EmailMessage, EmailProvider } from "../emailProvider.js";

// No real email provider configured yet — this is the honest, visible
// stand-in: logs to the server console instead of silently pretending an
// email was sent. Verification/reset links land here until a real
// EMAIL_PROVIDER (e.g. Resend, SendGrid, Postmark) is wired in — swap this
// for a real implementation of EmailProvider and select it in
// services/email.ts, nothing else in the auth flow needs to change.
export const consoleEmailProvider: EmailProvider = {
  async send(message: EmailMessage) {
    console.warn(
      [
        "",
        "=== DEV MODE: no real email provider configured — this was not sent ===",
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        "",
        message.text,
        "========================================================================",
        "",
      ].join("\n")
    );
  },
};
