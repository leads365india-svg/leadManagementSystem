import WorkspacesClient from "./workspaces-client"

export const metadata = {
  title: "Workspace Administration | Leads-365",
  description: "Configure multi-workspace SaaS projects, operating units, staff assignments, and autonomous lead routing.",
}

export default function WorkspacesPage() {
  return <WorkspacesClient />
}
