import { OAuth2Client } from "google-auth-library";

let client: OAuth2Client | null = null;
function getClient(): OAuth2Client {
  if (!client) client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  return client;
}

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

// Verifies a Google Identity Services ID token (the `credential` a Google
// Sign-In button hands back) server-side against Google's public keys — this
// is what actually proves the token wasn't forged, not just decoding the
// JWT. Never trust a client-supplied email/name without this.
export async function verifyGoogleCredential(idToken: string): Promise<GoogleProfile | null> {
  if (!process.env.GOOGLE_CLIENT_ID) return null;
  try {
    const ticket = await getClient().verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) return null;
    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name?.trim() || payload.email.split("@")[0],
      emailVerified: !!payload.email_verified,
    };
  } catch (err) {
    console.error("Google credential verification failed:", err);
    return null;
  }
}
