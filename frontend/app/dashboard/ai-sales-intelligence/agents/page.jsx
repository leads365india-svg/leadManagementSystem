import React, { Suspense } from "react"
import AISalesIntelligenceClient from "../ai-sales-intelligence-client"
import { RefreshCw } from "lucide-react"

export const metadata = {
  title: "Agent Performance Scorecards — AI Sales Intelligence | Leads-365 CRM",
  description: "Objective, evidence-backed agent scorecards across 7 measurable dimensions with sample-size thresholds.",
}

export default function AgentsScorecardsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50/50">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
        </div>
      }
    >
      <AISalesIntelligenceClient initialTab="scorecards" />
    </Suspense>
  )
}
