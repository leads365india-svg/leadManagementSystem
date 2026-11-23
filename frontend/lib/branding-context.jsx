"use client"

import React, { createContext, useContext, useState, useEffect, useCallback } from "react"
import { apiClient } from "@/lib/api"
import { isWhiteLabelDomain, normalizeHostname } from "@/lib/domain"
import { useAuth } from "@/lib/auth-context"

const DEFAULT_BRANDING = {
  displayName: "LeadFlow",
  companyName: "LeadFlow CRM",
  pageTitle: "LeadFlow - Lead Management System",
  logoUrl: "",
  primaryColor: "#4f46e5",
  customDomain: "",
  accountId: "",
  status: "active",
  isWhiteLabel: false,
}

const BrandingContext = createContext({
  branding: DEFAULT_BRANDING,
  isWhiteLabel: false,
  loading: false,
  refreshBranding: async () => {},
})

export function BrandingProvider({ children }) {
  const { user } = useAuth()
  const [branding, setBranding] = useState(DEFAULT_BRANDING)
  const [isWhiteLabel, setIsWhiteLabel] = useState(false)
  const [loading, setLoading] = useState(false)

  // Apply visual branding to document (title, meta, CSS theme variables)
  const applyBrandingToDOM = useCallback((brandData) => {
    if (typeof window === "undefined" || !brandData) return

    // 1. Update document title
    const isLoginPage = typeof window !== "undefined" && window.location.pathname.startsWith("/portal/login")
    const brandName = brandData.displayName || brandData.companyName
    let title =
      brandData.pageTitle ||
      (brandName ? `${brandName} CRM` : null)
    if (isLoginPage && brandName) {
      title = `${brandName} - Sign In`
    }
    if (title) {
      document.title = title
    }

    // 2. Set dynamic brand primary CSS custom property
    if (brandData.primaryColor) {
      document.documentElement.style.setProperty("--brand-primary", brandData.primaryColor)
    }

    // 3. Update favicon if custom logo URL is present
    if (brandData.logoUrl) {
      let iconLink = document.querySelector("link[rel*='icon']")
      if (!iconLink) {
        iconLink = document.createElement("link")
        iconLink.rel = "shortcut icon"
        document.head.appendChild(iconLink)
      }
      iconLink.href = brandData.logoUrl
    }
  }, [])

  // Resolve branding on initial mount based on current hostname or query params
  const resolveDomainBranding = useCallback(async () => {
    if (typeof window === "undefined") return

    const host = normalizeHostname(window.location.hostname)
    const urlParams = new URLSearchParams(window.location.search)
    const testDomain = urlParams.get("domain") || urlParams.get("test_domain") || ""
    const queryTenant = urlParams.get("tenant") || ""

    const effectiveHost = testDomain ? normalizeHostname(testDomain) : host
    const domainIsWhiteLabel = isWhiteLabelDomain(effectiveHost) || Boolean(testDomain)

    setIsWhiteLabel(domainIsWhiteLabel)

    // Lookup identifier: domain host or test domain or query tenant
    const lookupIdentifier = testDomain || (domainIsWhiteLabel ? effectiveHost : queryTenant)
    if (!lookupIdentifier) {
      return
    }

    try {
      setLoading(true)
      const cacheKey = `__branding_${lookupIdentifier}`
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) {
        try {
          const parsed = JSON.parse(cached)
          if (parsed && (parsed.displayName || parsed.companyName)) {
            const resolved = {
              ...DEFAULT_BRANDING,
              ...parsed,
              isWhiteLabel: true,
            }
            setBranding(resolved)
            applyBrandingToDOM(resolved)
          }
        } catch (_e) {}
      }

      let res = await apiClient.getBranding(lookupIdentifier)
      if (res && res.success && res.data && res.data.isWhiteLabel) {
        const data = res.data
        const resolved = {
          displayName: data.displayName || data.companyName || "Client CRM",
          companyName: data.companyName || data.displayName || "Client CRM",
          pageTitle: data.browserPageTitle || data.displayName || data.companyName || "Client CRM Portal",
          browserPageTitle: data.browserPageTitle || data.displayName || data.companyName || "Client CRM Portal",
          logoUrl: data.logoUrl || "",
          primaryColor: data.brandPrimaryColor || "#4f46e5",
          brandPrimaryColor: data.brandPrimaryColor || "#4f46e5",
          customDomain: effectiveHost,
          tenantId: data.tenantId || data.accountId || "",
          accountId: data.accountId || data.tenantId || "",
          status: "active",
          isWhiteLabel: true,
        }
        setBranding(resolved)
        applyBrandingToDOM(resolved)
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(resolved))
        } catch (_e) {}
      } else {
        res = await apiClient.getTenantInfo(lookupIdentifier)
        if (res && res.success && res.data) {
          const data = res.data
          const resolved = {
            displayName: data.displayName || data.companyName || "Client CRM",
            companyName: data.companyName || data.displayName || "Client CRM",
            pageTitle: data.pageTitle || data.displayName || data.companyName || "Client CRM Portal",
            browserPageTitle: data.pageTitle || data.displayName || data.companyName || "Client CRM Portal",
            logoUrl: data.logoUrl || "",
            primaryColor: data.primaryColor || "#4f46e5",
            brandPrimaryColor: data.primaryColor || "#4f46e5",
            customDomain: data.customDomain || effectiveHost,
            tenantId: data.accountId || "",
            accountId: data.accountId || "",
            status: data.status || "active",
            isWhiteLabel: Boolean(domainIsWhiteLabel || data.customDomain),
          }
          setBranding(resolved)
          applyBrandingToDOM(resolved)
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify(resolved))
          } catch (_e) {}
        }
      }
    } catch (err) {
      console.warn("Could not fetch domain branding for:", lookupIdentifier, err)
    } finally {
      setLoading(false)
    }
  }, [applyBrandingToDOM])

  // Initial domain branding check
  useEffect(() => {
    resolveDomainBranding()
  }, [resolveDomainBranding])

  // Synchronize branding with authenticated user account metadata
  // Strictly prohibits cross-tenant contamination: user session from Tenant A cannot override Tenant B domain branding
  useEffect(() => {
    if (user && user.account) {
      if (isWhiteLabel && branding?.accountId) {
        if (user.tenantId && user.tenantId !== branding.accountId) {
          console.warn("Blocked cross-tenant branding contamination from user session:", {
            sessionTenant: user.tenantId,
            domainTenant: branding.accountId,
          })
          return
        }
      }

      const acc = user.account
      setBranding((prev) => {
        // Double-check inside state updater as well
        if (isWhiteLabel && prev.accountId && acc.accountId && acc.accountId !== prev.accountId) {
          return prev
        }
        const merged = {
          ...prev,
          displayName: acc.displayName || acc.companyName || prev.displayName,
          companyName: acc.companyName || acc.displayName || prev.companyName,
          pageTitle: acc.pageTitle || acc.displayName || acc.companyName || prev.pageTitle,
          logoUrl: acc.logoUrl || prev.logoUrl,
          primaryColor: acc.primaryColor || prev.primaryColor,
          customDomain: acc.customDomain || prev.customDomain,
          accountId: acc.accountId || prev.accountId,
          status: acc.status || prev.status,
          isWhiteLabel: prev.isWhiteLabel || Boolean(acc.customDomain),
        }
        applyBrandingToDOM(merged)
        return merged
      })
    }
  }, [user, isWhiteLabel, branding?.accountId, applyBrandingToDOM])

  const value = {
    branding,
    isWhiteLabel,
    loading,
    refreshBranding: resolveDomainBranding,
  }

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}

export function useBranding() {
  const context = useContext(BrandingContext)
  if (!context) {
    throw new Error("useBranding must be used within a BrandingProvider")
  }
  return context
}
