"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function DashboardRoute() {
  const router = useRouter()

  useEffect(() => {
    // Navigate to Client CRM Portal Dashboard
    router.replace("/portal")
  }, [router])

  return (
    <div className="min-h-[60vh] flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center space-y-3">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-medium text-slate-500">Redirecting to Client Dashboard...</p>
      </div>
    </div>
  )
}
