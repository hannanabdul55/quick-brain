import { redirect, notFound } from "next/navigation"
import { resolveTenant } from "@/lib/auth/resolve-tenant"
import { ChatSurface } from "@/components/chat/chat-surface"
import { InsightCardsRow } from "@/components/insights/insight-cards-row"

interface DashPageProps {
  params: Promise<{ id: string }>
}

export default async function DashPage({ params }: DashPageProps) {
  const { id } = await params

  // Session gate — D-11: tenant identity comes only from the verified session.
  // Never from the URL slug (Shared Pattern E, T-06-18).
  const ctx = await resolveTenant()
  if (!ctx.authenticated) {
    redirect("/sign-in")
  }

  // Slug mismatch guard: if the URL slug doesn't match the session-resolved slug,
  // the user is either trying to view another user's dashboard (T-06-18) or landed
  // on a stale URL. Redirect them to their own dashboard.
  if (id !== ctx.brainSlug) {
    redirect(`/dash/${ctx.brainSlug}`)
  }

  // At this point ctx.brainSlug === id and the user is authenticated.
  // Use the session-resolved sourceId for all gbrain calls (never the URL slug).
  return (
    <>
      <InsightCardsRow tenantId={ctx.brainSlug} />
      <ChatSurface tenantId={ctx.brainSlug} businessName={ctx.brainSlug} />
    </>
  )
}
