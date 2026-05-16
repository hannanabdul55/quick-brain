import { notFound } from "next/navigation"
import { tenantSlugSchema } from "@/lib/gbrain/slug"
import * as tenants from "@/lib/gbrain/tenants"
import { ChatSurface } from "@/components/chat/chat-surface"
import { InsightCardsRow } from "@/components/insights/insight-cards-row"

interface DashPageProps {
  params: Promise<{ id: string }>
}

export default async function DashPage({ params }: DashPageProps) {
  const { id } = await params

  const parsed = tenantSlugSchema.safeParse(id)
  if (!parsed.success) {
    notFound()
  }

  await tenants.init()
  const tenant = tenants.get(parsed.data)
  if (!tenant) {
    notFound()
  }

  return (
    <>
      <InsightCardsRow tenantId={tenant.id} />
      <ChatSurface tenantId={tenant.id} businessName={tenant.id} />
    </>
  )
}
