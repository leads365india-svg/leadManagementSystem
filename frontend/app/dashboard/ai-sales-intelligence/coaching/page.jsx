import React, { Suspense } from "react"
import AISalesIntelligenceClient from "../ai-sales-intelligence-client"
import { RefreshCw } from "lucide-react"

export const metadata = {
  title: "1-on-1 Coaching Reviews — AI Sales Intelligence | Leads-365 CRM",
  description: "Manager coaching reviews, structured feedback, agreed action items, and performance tracking.",
}

export default function CoachingReviewsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50/50">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
        </div>
      }
    >
      <AISalesIntelligenceClient initialTab="coaching-reviews" />
    </Suspense>
  )
}
