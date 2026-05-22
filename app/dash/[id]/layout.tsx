/**
 * app/dash/[id]/layout.tsx — Dashboard layout with sign-out control.
 *
 * Adds a minimal header row to the dashboard surface holding the SignOutButton
 * client island. The layout itself is a server component; SignOutButton is the
 * "use client" island.
 *
 * Per UI-SPEC: right-aligned header row, no nav chrome. The dashboard had no
 * layout before Phase 6 — this is the first layout added to app/dash/.
 */

import { SignOutButton } from "@/components/auth/sign-out-button";

interface DashLayoutProps {
  children: React.ReactNode;
}

export default function DashLayout({ children }: DashLayoutProps) {
  return (
    <>
      <header className="flex justify-end items-center px-4 py-2 border-b border-border">
        <SignOutButton />
      </header>
      {children}
    </>
  );
}
