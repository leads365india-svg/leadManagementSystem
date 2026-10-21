import CrmPlaceholderPage from "@/components/crm-placeholder-page"

export const metadata = {
  title: "Assign Leads | LeadFlow CRM",
}

export default function AssignLeadsPage() {
  return (
    <CrmPlaceholderPage
      title="Assign Leads"
      category="Tools"
      description="Distribute leads across sales agents using round-robin routing, territory rules, or manual reassignment."
    />
  )
}
