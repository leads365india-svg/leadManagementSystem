import CrmPlaceholderPage from "@/components/crm-placeholder-page"

export const metadata = {
  title: "Message Templates | LeadFlow CRM",
}

export default function MessageTemplatesPage() {
  return (
    <CrmPlaceholderPage
      title="Message Templates"
      category="Settings"
      description="Configure email boilerplate copy, SMS follow-up templates, and automated WhatsApp notification macros."
    />
  )
}
