"use client"

import { useEffect } from "react"

export default function ErrorBoundary({ error, reset }) {
  useEffect(() => {
    const msg = error?.message || ""
    if (
      msg.includes("ChunkLoadError") ||
      msg.includes("Loading chunk") ||
      msg.includes("timeout")
    ) {
      try {
        const key = "__chunk_retry_ts"
        const last = sessionStorage.getItem(key)
        const now = Date.now()
        if (!last || now - parseInt(last, 10) > 3000) {
          sessionStorage.setItem(key, now.toString())
          window.location.reload()
          return
        }
      } catch (_) {
        window.location.reload()
        return
      }
    }
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md rounded-2xl bg-white p-8 shadow-lg border border-slate-200">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600">
          <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">Syncing with Server...</h2>
        <p className="text-sm text-slate-600 mb-6">
          A newer module or page chunk is loading. If this does not update automatically, click Reload.
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => {
              if (reset) reset()
              else window.location.reload()
            }}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-blue-700 transition"
          >
            Reload Page
          </button>
        </div>
      </div>
    </div>
  )
}
