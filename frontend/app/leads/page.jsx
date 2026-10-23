import { Suspense } from "react"
import LeadsClient from "./leads-client"
import Breadcrumb from "@/components/breadcrumb"

export const metadata = {
  title: "All Leads | LeadFlow CRM",
  description: "Manage, organize, and track all your leads in one place.",
}

export default function LeadsPage() {
  const breadcrumbItems = [
    { label: "Dashboard", href: "/" },
    { label: "Leads", href: "/leads" },
    { label: "All Leads" },
  ]

  return (
    <Suspense
        fallback={
          <div className="w-full px-4 sm:px-6 lg:px-8 py-12 flex items-center justify-center min-h-[400px]">
            <div className="flex flex-col items-center space-y-3">
              <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-slate-500 font-medium">Loading All Leads...</p>
            </div>
          </div>
        }
      >
      <LeadsClient />
    </Suspense>
  )
}
