import CrmPlaceholderPage from "@/components/crm-placeholder-page"

export const metadata = {
  title: "Data Management | LeadFlow CRM",
}

export default function DataManagementPage() {
  return (
    <CrmPlaceholderPage
      title="Data Management"
      category="Tools"
      description="Manage lead database hygiene, purge obsolete records, export archives, and merge duplicate contacts."
    />
  )
}
