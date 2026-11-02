import React, { Suspense } from "react"
import AISalesIntelligenceClient from "./ai-sales-intelligence-client"
import { RefreshCw } from "lucide-react"

export const metadata = {
  title: "AI Sales Performance, Coaching & Business Intelligence | Leads-365 CRM",
  description: "Sales performance dashboard, agent scorecards, evidence-backed AI coaching, lead prioritization, and manager analytics.",
}

export default function AISalesIntelligencePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50/50">
          <div className="flex flex-col items-center gap-3">
            <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
            <p className="text-xs font-semibold text-slate-500">Loading AI Sales Intelligence...</p>
          </div>
        </div>
      }
    >
      <AISalesIntelligenceClient />
    </Suspense>
  )
}
