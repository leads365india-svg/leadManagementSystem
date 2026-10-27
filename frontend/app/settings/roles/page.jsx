import RolesClient from "./roles-client"

export const metadata = {
  title: "Roles & Scoped Permissions | Leads-365",
  description: "Configure tenant roles, granular permission scopes (own, team, all), and security access policies.",
}

export default function RolesPage() {
  return <RolesClient />
}
