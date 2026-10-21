import CrmPlaceholderPage from "@/components/crm-placeholder-page"

export const metadata = {
  title: "Custom Fields | LeadFlow CRM",
}

export default function CustomFieldsPage() {
  return (
    <CrmPlaceholderPage
      title="Custom Fields"
      category="Settings"
      description="Configure custom attributes, metadata tags, and client specific data properties on lead objects."
    />
  )
}
