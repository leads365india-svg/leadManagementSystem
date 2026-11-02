import React, { Suspense } from "react"
import AISalesIntelligenceClient from "../ai-sales-intelligence-client"
import { RefreshCw } from "lucide-react"

export const metadata = {
  title: "Lead Prioritization Hub — AI Sales Intelligence | Leads-365 CRM",
  description: "Explainable lead priority signals based on call outcomes, overdue follow-ups, and commercial intent.",
}

export default function LeadPrioritiesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50/50">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
        </div>
      }
    >
      <AISalesIntelligenceClient initialTab="lead-priorities" />
    </Suspense>
  )
}
