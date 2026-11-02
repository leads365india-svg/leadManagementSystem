import React, { Suspense } from "react"
import AICallIntelligenceClient from "./ai-call-intelligence-client"
import { RefreshCw } from "lucide-react"

export const metadata = {
  title: "AI Call Intelligence — Conversation Analytics & Transcripts | Leads-365 CRM",
  description: "Automated call transcription, speech-to-text, executive summaries, sentiment detection, and approved semantic topic matching.",
}

export default function AICallIntelligencePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50/50">
          <div className="flex flex-col items-center gap-3">
            <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
            <p className="text-xs font-semibold text-slate-500">Loading AI Call Intelligence...</p>
          </div>
        </div>
      }
    >
      <AICallIntelligenceClient />
    </Suspense>
  )
}
