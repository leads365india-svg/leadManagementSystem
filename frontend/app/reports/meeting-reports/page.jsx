import CrmPlaceholderPage from "@/components/crm-placeholder-page"

export const metadata = {
  title: "Meeting Reports | LeadFlow CRM",
}

export default function MeetingReportsPage() {
  return (
    <CrmPlaceholderPage
      title="Meeting Reports"
      category="Reports"
      description="Metrics on scheduled demos, meeting show rates, pipeline conversions following sales presentations."
    />
  )
}
