/**
 * lib/auth/email.ts — Transactional magic-link email via Resend.
 *
 * Module-level Resend singleton mirrors lib/inngest/client.ts exactly —
 * construct once, export a thin wrapper.
 *
 * Security:
 *   T-06-13: sendMagicLink never logs the email address or the token URL.
 *   Metadata-only logging — mirror the chat/route.ts "log metadata only"
 *   precedent.
 *
 * Copywriting follows UI-SPEC Copywriting Contract tone:
 *   - Plain, non-technical language for a non-technical SMB owner
 *   - "one-time sign-in link", "expires in 15 minutes"
 *   - No internal terms: "token", "JWT", "session", "TTL"
 */

import { Resend } from "resend";

// ---------------------------------------------------------------------------
// Lazy Resend client — construct at first send, not at module load.
//
// `next build` ("Collecting page data") imports every route module, which
// transitively imports this file. A module-top-level throw breaks the build
// whenever RESEND_API_KEY is absent from the build env. Reading at call time
// keeps the build green and still fails loudly the first time email runs.
// ---------------------------------------------------------------------------
function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("lib/auth/email.ts: RESEND_API_KEY must be set");
  }
  return new Resend(key);
}

// ---------------------------------------------------------------------------
// sendMagicLink
// ---------------------------------------------------------------------------

/**
 * Send a magic-link email to the given address.
 *
 * The verifyUrl already contains the signed token — this function sends it.
 * It NEVER logs the email address or the verifyUrl (T-06-13).
 *
 * @param email      The recipient's email address
 * @param verifyUrl  The full magic-link URL (e.g. https://app.example.com/auth/verify?token=...)
 * @throws           Re-throws Resend API errors (caller decides on retry policy)
 */
export async function sendMagicLink(
  email: string,
  verifyUrl: string,
): Promise<void> {
  // From-address is env-driven so test mode (no verified domain) and
  // production (verified domain) can swap without a code change.
  // Default: Resend's shared dev sender — works without owning a domain,
  // but Resend will only deliver to addresses verified in your Resend
  // dashboard until you set RESEND_FROM_ADDRESS to a verified-domain address.
  const fromAddress =
    process.env.RESEND_FROM_ADDRESS ?? "QuickBrain <onboarding@resend.dev>";

  const { error } = await getResend().emails.send({
    from: fromAddress,
    to: [email],
    subject: "Your QuickBrain sign-in link",
    html: buildEmailHtml(verifyUrl),
    text: buildEmailText(verifyUrl),
  });

  if (error) {
    // Log only that a send failed, never the email or token
    console.error("[auth/email] Resend API error:", error.name);
    throw new Error(`sendMagicLink: Resend error — ${error.name}`);
  }
  // Log only that a send occurred, not who it went to (T-06-13)
  console.log("[auth/email] magic-link sent");
}

// ---------------------------------------------------------------------------
// Email templates (Claude's Discretion per CONTEXT.md)
// Copywriting locked by UI-SPEC Copywriting Contract:
//   - "one-time sign-in link", "expires in 15 minutes"
//   - Plain, calm, non-technical tone
// ---------------------------------------------------------------------------

function buildEmailHtml(verifyUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your QuickBrain sign-in link</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: #ffffff; color: #111827; margin: 0; padding: 0; }
    .container { max-width: 480px; margin: 40px auto; padding: 32px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; }
    .heading { font-size: 20px; font-weight: 600; margin: 0 0 16px; }
    .body { font-size: 16px; line-height: 1.5; color: #374151; margin: 0 0 24px; }
    .button { display: inline-block; padding: 12px 24px; background: #111827; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 500; }
    .footer { margin-top: 24px; font-size: 13px; color: #6b7280; line-height: 1.5; }
    .link { color: #6b7280; word-break: break-all; }
  </style>
</head>
<body>
  <div class="container">
    <p class="heading">Sign in to QuickBrain</p>
    <p class="body">
      Click the button below to sign in. This is a one-time sign-in link —
      it works once and expires in 15 minutes.
    </p>
    <a href="${verifyUrl}" class="button">Sign in to QuickBrain</a>
    <div class="footer">
      <p>If the button doesn't work, copy and paste this link into your browser:</p>
      <p><a href="${verifyUrl}" class="link">${verifyUrl}</a></p>
      <p>If you didn't request this, you can safely ignore this email — someone may have entered your address by mistake.</p>
    </div>
  </div>
</body>
</html>`;
}

function buildEmailText(verifyUrl: string): string {
  return `Sign in to QuickBrain

Click this link to sign in. It's a one-time sign-in link — it works once and expires in 15 minutes.

${verifyUrl}

If you didn't request this, you can safely ignore this email.`;
}
