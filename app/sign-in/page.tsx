"use client";

import { Suspense, useEffect, useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/onboard/error-banner";
import { sendLinkBodySchema } from "@/lib/auth/schemas";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type PageState =
  | { type: "form"; emailError?: string }
  | { type: "submitting" }
  | { type: "sent"; email: string }
  | { type: "error"; message: string }
  | { type: "rate-limited" };

// ---------------------------------------------------------------------------
// Sign-in page
// ---------------------------------------------------------------------------

// Next.js 15 requires `useSearchParams()` callers in client components to
// sit inside a Suspense boundary, otherwise the entire route deopts during
// static prerender. The exported page wraps the form in <Suspense> so the
// build can statically prerender the shell.
function SignInForm() {
  const searchParams = useSearchParams();
  // Read ?next= opaquely — never render it as visible copy (T-06-20)
  const next = searchParams.get("next") ?? undefined;

  const [state, setState] = useState<PageState>({ type: "form" });
  const [email, setEmail] = useState("");
  const emailErrorId = useId();

  // Re-focus the input when returning to form state
  useEffect(() => {
    if (state.type === "form") {
      const input = document.getElementById("email-input");
      input?.focus();
    }
  }, [state.type]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Client-side zod validation
    const parsed = sendLinkBodySchema.safeParse({ email, next });
    if (!parsed.success) {
      const msg =
        parsed.error.issues[0]?.message ?? "Enter a valid email address.";
      setState({ type: "form", emailError: msg });
      return;
    }

    setState({ type: "submitting" });

    try {
      const response = await fetch("/api/auth/send-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      if (response.status === 200 || response.status === 202) {
        setState({ type: "sent", email: parsed.data.email });
        return;
      }

      if (response.status === 429) {
        setState({ type: "rate-limited" });
        return;
      }

      // Other error
      setState({
        type: "error",
        message:
          "We couldn't send your link right now. Check your connection and try again.",
      });
    } catch {
      setState({
        type: "error",
        message:
          "We couldn't send your link right now. Check your connection and try again.",
      });
    }
  }

  async function handleSendAgain() {
    // Re-POST with the same email — server enforces 60s rate limit
    setState({ type: "submitting" });
    try {
      const response = await fetch("/api/auth/send-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, next }),
      });

      if (response.status === 200 || response.status === 202) {
        // Reset to sent (user sees confirmation again)
        setState({ type: "sent", email });
        return;
      }

      if (response.status === 429) {
        setState({ type: "rate-limited" });
        return;
      }

      setState({
        type: "error",
        message:
          "We couldn't send your link right now. Check your connection and try again.",
      });
    } catch {
      setState({
        type: "error",
        message:
          "We couldn't send your link right now. Check your connection and try again.",
      });
    }
  }

  const isSubmitting = state.type === "submitting";

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md mx-auto space-y-4">

        {/* Form state + submitting state */}
        {(state.type === "form" || state.type === "submitting") && (
          <Card>
            <CardHeader>
              <CardTitle>Sign in to QuickBrain</CardTitle>
              <CardDescription>
                Enter your email and we&apos;ll send you a one-time sign-in
                link. No password needed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
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
                    disabled={isSubmitting}
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
                    <p
                      id={emailErrorId}
                      className="text-sm text-red-900"
                    >
                      {state.emailError}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full mt-2"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Sending…" : "Send magic link"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Sent state — check your email confirmation */}
        {state.type === "sent" && (
          <Card>
            <CardHeader>
              <CardTitle>Check your email</CardTitle>
              <CardDescription>
                We sent a sign-in link to{" "}
                <strong>{state.email}</strong>. Click it to continue &mdash; the
                link works once and expires in 15 minutes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleSendAgain}
              >
                Didn&apos;t get it? <strong>Send again</strong>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Rate-limited state */}
        {state.type === "rate-limited" && (
          <Card>
            <CardHeader>
              <CardTitle>Check your email</CardTitle>
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

        {/* Error state */}
        {state.type === "error" && (
          <ErrorBanner
            message={state.message}
            onRetry={() => setState({ type: "form" })}
          />
        )}
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
