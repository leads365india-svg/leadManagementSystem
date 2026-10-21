import CrmPlaceholderPage from "@/components/crm-placeholder-page"

export const metadata = {
  title: "Import Leads | LeadFlow CRM",
}

export default function ImportLeadsPage() {
  return (
    <CrmPlaceholderPage
      title="Import Leads"
      category="Tools"
      description="Bulk upload leads via CSV, Excel, or JSON formats with automated column mapping and deduplication."
    />
  )
}
