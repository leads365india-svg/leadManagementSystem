import ImportLeadsClient from "./import-leads-client"

export const metadata = {
  title: "Import Leads | LeadFlow CRM",
  description: "Bulk upload leads via CSV, Excel (.xlsx/.xls), or JSON with automatic column mapping, validation, and tenant-scoped deduplication.",
}

export default function ImportLeadsPage() {
  return <ImportLeadsClient />
}
