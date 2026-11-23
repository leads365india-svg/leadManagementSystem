import { headers } from "next/headers"
import { Suspense, cache } from "react"
import { normalizeHostname, isWhiteLabelDomain } from "@/lib/domain"
import PortalLoginClient from "./portal-login-client"

/**
 * Server-side memoized branding retriever for white-label domains.
 * Allows SSR to fetch and embed tenant branding in initial HTML before first paint,
 * eliminating any flash of generic "Client CRM Portal Login" or "Tenant Account ID".
 */
const fetchServerBranding = cache(async (queryHost) => {
  if (!queryHost || !isWhiteLabelDomain(queryHost)) {
    return null
  }

  try {
    const apiBase =
      process.env.INTERNAL_BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:5000/api"
    const cleanBase = apiBase.replace(/\/$/, "")
    const url = `${cleanBase}/auth/branding?domain=${encodeURIComponent(queryHost)}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)

    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (res.ok) {
      const json = await res.json()
      if (json?.success && json?.data?.isWhiteLabel) {
        return json.data
      }
    }
  } catch (_e) {
    // Graceful fallback for SSR; client component handles graceful skeleton hydration
  }

  return null
})

export async function generateMetadata({ searchParams }) {
  const headerList = await headers()
  const rawHost =
    headerList.get("x-forwarded-host") ||
    headerList.get("host") ||
    ""
  const host = normalizeHostname(rawHost)

  const resolvedParams = searchParams ? await searchParams : {}
  const testDomain = resolvedParams.domain || resolvedParams.test_domain || ""
  const queryHost = testDomain ? normalizeHostname(testDomain) : host

  const branding = await fetchServerBranding(queryHost)

  if (branding?.isWhiteLabel) {
    const brandTitle =
      branding.browserPageTitle ||
      branding.displayName ||
      branding.companyName ||
      "Client CRM"
    return {
      title: `${brandTitle} - Sign In`,
      description: `Sign in to access ${brandTitle}'s CRM workspace`,
    }
  }

  return {
    title: "Client CRM Portal Login - Leads365",
    description: "Sign in with your Leads Account Administrator credentials",
  }
}

export default async function PortalLoginPage({ searchParams }) {
  const headerList = await headers()
  const rawHost =
    headerList.get("x-forwarded-host") ||
    headerList.get("host") ||
    ""
  const host = normalizeHostname(rawHost)

  const resolvedParams = searchParams ? await searchParams : {}
  const testDomain = resolvedParams.domain || resolvedParams.test_domain || ""
  const queryHost = testDomain ? normalizeHostname(testDomain) : host
  const isWhiteLabelCandidate = isWhiteLabelDomain(queryHost) || Boolean(testDomain)

  const initialBranding = await fetchServerBranding(queryHost)
  const initialIsWhiteLabel = Boolean(initialBranding?.isWhiteLabel)

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
        </div>
      }
    >
      <PortalLoginClient
        initialBranding={initialBranding}
        initialHost={queryHost || host}
        initialIsWhiteLabelCandidate={isWhiteLabelCandidate}
        initialIsWhiteLabel={initialIsWhiteLabel}
        initialSearchParams={resolvedParams}
      />
    </Suspense>
  )
}
