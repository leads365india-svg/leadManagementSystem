import AssignLeadsClient from "./assign-leads-client"

export const metadata = {
  title: "Lead Allocation & Assignment | Leads-365",
  description: "Distribute leads across sales agents using automated routing rules, unassigned pool, or bulk reassignment.",
}

export default function AssignLeadsPage() {
  return <AssignLeadsClient />
}

