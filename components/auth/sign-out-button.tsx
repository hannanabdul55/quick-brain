"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Sign-out button — dashboard header control
//
// Analog: components/onboard/error-banner.tsx (small "use client" + Button component)
//         components/jobs/job-progress.tsx (lucide icon import + Button usage)
//
// UI-SPEC: variant="ghost" size="sm" + LogOut icon + "Sign out" label.
//   idle → signing-out (disabled, "Signing out…") → POST /api/auth/sign-out
//   → redirect to /sign-in (server clears the qb_session cookie, AUTH-07).
// ---------------------------------------------------------------------------

type SignOutState = "idle" | "signing-out";

export function SignOutButton() {
  const router = useRouter();
  const [state, setState] = useState<SignOutState>("idle");

  async function handleSignOut() {
    if (state === "signing-out") return;
    setState("signing-out");

    try {
      await fetch("/api/auth/sign-out", { method: "POST" });
    } catch {
      // Resilient: sign out regardless of network error.
      // The cookie will be cleared server-side if the request succeeded;
      // if it failed, the user is sent to /sign-in which will re-validate.
    }

    // Always redirect to sign-in — the server cleared the cookie on success
    router.push("/sign-in");
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={state === "signing-out"}
      onClick={handleSignOut}
      className="text-sm"
    >
      <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
      {state === "signing-out" ? "Signing out…" : "Sign out"}
    </Button>
  );
}
