"use client";

import { useId, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { sendLinkBodySchema } from "@/lib/auth/schemas";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type PageState =
  | { type: "form"; emailError?: string }
  | { type: "resending" }
  | { type: "resent"; email: string }
  | { type: "rate-limited" };

// ---------------------------------------------------------------------------
// Link-used / expired page
// ---------------------------------------------------------------------------

export default function LinkUsedPage() {
  const [state, setState] = useState<PageState>({ type: "form" });
  const [email, setEmail] = useState("");
  const emailErrorId = useId();

  async function handleResend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Client-side validation
    const parsed = sendLinkBodySchema.safeParse({ email });
    if (!parsed.success) {
      const msg =
        parsed.error.issues[0]?.message ?? "Enter a valid email address.";
      setState({ type: "form", emailError: msg });
      return;
    }

    setState({ type: "resending" });

    try {
      const response = await fetch("/api/auth/send-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: parsed.data.email }),
      });

      if (response.status === 200 || response.status === 202) {
        setState({ type: "resent", email: parsed.data.email });
        return;
      }

      if (response.status === 429) {
        setState({ type: "rate-limited" });
        return;
      }

      // Other errors — show a generic resend failure in the form
      setState({ type: "form", emailError: "We couldn't send your link right now. Check your connection and try again." });
    } catch {
      setState({ type: "form", emailError: "We couldn't send your link right now. Check your connection and try again." });
    }
  }

  const isResending = state.type === "resending";

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md mx-auto space-y-4">

        {/* Static explanatory card + resend form */}
        {(state.type === "form" || state.type === "resending") && (
          <Card>
            <CardHeader>
              <CardTitle>{"This link can't be used"}</CardTitle>
              <CardDescription>
                This sign-in link has expired or was already used. Magic links
                work once and last 15 minutes. Request a fresh one below.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleResend} className="space-y-4">
                <div className="space-y-1">
                  <label
                    htmlFor="email-input"
                    className="text-sm font-medium text-foreground"
                  >
                    Email
                  </label>
                  <Input
                    id="email-input"
                    type="email"
                    required
                    autoComplete="email"
                    autoFocus
                    placeholder="you@yourbusiness.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isResending}
                    aria-describedby={
                      state.type === "form" && state.emailError
                        ? emailErrorId
                        : undefined
                    }
                    aria-invalid={
                      state.type === "form" && !!state.emailError
                        ? true
                        : undefined
                    }
                  />
                  {state.type === "form" && state.emailError && (
                    <p id={emailErrorId} className="text-sm text-red-900">
                      {state.emailError}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full mt-2"
                  disabled={isResending}
                >
                  {isResending ? "Sending…" : "Resend magic link"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Resent state — check your email confirmation */}
        {state.type === "resent" && (
          <Card>
            <CardHeader>
              <CardTitle>Check your email</CardTitle>
              <CardDescription>
                We sent a sign-in link to{" "}
                <strong>{state.email}</strong>. Click it to continue &mdash; the
                link works once and expires in 15 minutes.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {/* Rate-limited state */}
        {state.type === "rate-limited" && (
          <Card>
            <CardHeader>
              <CardTitle>Too many requests</CardTitle>
              <CardDescription>
                You just requested a link. Wait a minute before asking for
                another.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setState({ type: "form" })}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
