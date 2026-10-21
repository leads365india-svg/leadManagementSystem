"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function UniversalLoginPage() {
  const router = useRouter()

  useEffect(() => {
    // Redirect to Client CRM Portal Login by default
    router.replace("/portal/login")
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
