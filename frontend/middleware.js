import { NextResponse } from "next/server"
import { isWhiteLabelDomain } from "./lib/domain"

/**
 * Next.js Edge Middleware for White-Label Routing (Phase 30)
 *
 * Intercepts requests on tenant white-label domains:
 * - Redirects "/" and "/super-admin/*" straight to "/portal/login"
 * - Ensures clients on custom domains (e.g. crm.medical365.in) NEVER see the Super Admin Portal.
 */
export function middleware(request) {
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    ""

  if (isWhiteLabelDomain(host)) {
    const { pathname } = request.nextUrl

    // 1. Strictly block Super Admin routes on white-label domains
    if (pathname.startsWith("/super-admin")) {
      const loginUrl = new URL("/portal/login", request.url)
      loginUrl.search = request.nextUrl.search
      return NextResponse.redirect(loginUrl)
    }

    // 2. Visiting root '/' directly opens the Client CRM Portal:
    // If authenticated (cookie present), direct to /portal; otherwise send to /portal/login
    if (pathname === "/") {
      const hasAuthCookie =
        request.cookies.has("client_token") ||
        request.cookies.has("token")
      const targetPath = hasAuthCookie ? "/portal" : "/portal/login"
      const destination = new URL(targetPath, request.url)
      destination.search = request.nextUrl.search
      return NextResponse.redirect(destination)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/",
    "/super-admin/:path*",
  ],
}
