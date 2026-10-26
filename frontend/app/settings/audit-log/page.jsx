import AuditLogClient from "./audit-log-client"

export const metadata = {
  title: "Audit Log & Security Trail | Leads-365",
  description: "Inspect chronological trail of account security, staff modifications, and CRM operations.",
}

export default function AuditLogPage() {
  return <AuditLogClient />
}
