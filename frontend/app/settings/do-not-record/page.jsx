import CrmPlaceholderPage from "@/components/crm-placeholder-page"

export const metadata = {
  title: "Do-Not-Record List | LeadFlow CRM",
}

export default function DoNotRecordPage() {
  return (
    <CrmPlaceholderPage
      title="Do-Not-Record"
      category="Settings"
      description="Manage compliance phone numbers, GDPR/TCPA opt-outs, and restricted customer contact lists."
    />
  )
}
