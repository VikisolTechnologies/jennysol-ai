import { consoleEmailProvider } from "./emailProviders/console.js";
import type { EmailProvider } from "./emailProvider.js";

// Swap in a real EmailProvider here (Resend/SendGrid/Postmark/SES) once one
// is configured, selected via env var the same way LLM_PROVIDER works.
const provider: EmailProvider = consoleEmailProvider;

export function sendEmail(to: string, subject: string, text: string): Promise<void> {
  return provider.send({ to, subject, text });
}
