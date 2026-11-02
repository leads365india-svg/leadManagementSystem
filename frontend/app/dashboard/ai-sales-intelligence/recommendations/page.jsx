import React, { Suspense } from "react"
import AISalesIntelligenceClient from "../ai-sales-intelligence-client"
import { RefreshCw } from "lucide-react"

export const metadata = {
  title: "Manager Alerts & Recommendations — AI Sales Intelligence | Leads-365 CRM",
  description: "Actionable manager alerts, high-intent follow-up requests, and recurring objection signals.",
}

export default function ManagerRecommendationsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50/50">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
        </div>
      }
    >
      <AISalesIntelligenceClient initialTab="recommendations" />
    </Suspense>
  )
}
