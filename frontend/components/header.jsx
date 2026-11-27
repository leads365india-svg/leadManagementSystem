"use client"

import React, { useState, useEffect, useRef, useMemo } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useBranding } from "@/lib/branding-context"
import { isWhiteLabelDomain } from "@/lib/domain"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import {
  LayoutDashboard,
  Users,
  UserPlus,
  Sparkles,
  Activity,
  CheckCircle2,
  XCircle,
  PhoneCall,
  Calendar,
  Clock,
  ArrowUpRight,
  UploadCloud,
  UserCheck,
  Database,
  BarChart3,
  Phone,
  Video,
  TrendingUp,
  Radio,
  Sliders,
  Layers,
  FileSpreadsheet,
  Rss,
  MessageSquare,
  Shield,
  History,
  PhoneOff,
  Search,
  Maximize,
  Minimize,
  LogOut,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Menu,
  X,
  Plus,
  Building2,
  Bell,
  FileText,
  Mail,
} from "lucide-react"
import FollowUpAlertManager from "@/components/follow-up-alert-manager"

// Complete Six-Category CRM Navigation Structure (Granular RBAC permission keys assigned)
const NAV_CATEGORIES = [
  {
    id: "main",
    label: "Home",
    icon: LayoutDashboard,
    href: "/portal",
    permission: "dashboard.view",
    items: [
      {
        id: "main-dashboard",
        label: "Home",
        href: "/portal",
        description: "Pipeline KPIs, metrics & lead velocity",
        icon: LayoutDashboard,
        permission: "dashboard.view",
      },
    ],
  },
  {
    id: "leads",
    label: "Leads",
    icon: Users,
    href: "/leads",
    permission: "leads.view*",
    items: [
      {
        id: "leads-manage",
        label: "Manage Leads",
        href: "/leads",
        description: "Complete database of sales inquiries",
        icon: Users,
        permission: "leads.view*",
      },
    ],
  },
  {
    id: "communication",
    label: "Communication",
    icon: PhoneCall,
    href: "/communication/call-reports",
    items: [
      {
        id: "comm-call-reports",
        label: "Call Reports",
        href: "/communication/call-reports",
        description: "Agent call logs and audio durations",
        icon: PhoneCall,
        permission: "calls.view*",
      },
      {
        id: "comm-ai-intelligence",
        label: "AI Call Intelligence",
        href: "/dashboard/ai-call-intelligence",
        description: "Transcripts, summaries & conversation analytics",
        icon: Sparkles,
        permission: "calls.view*",
      },
      {
        id: "comm-meetings",
        label: "Meetings",
        href: "/communication/meetings",
        description: "Scheduled client demos and briefings",
        icon: Calendar,
        permission: "followups.view*",
      },
      {
        id: "comm-reminders",
        label: "Reminders",
        href: "/communication/reminders",
        description: "Pending tasks and time-sensitive alerts",
        icon: Clock,
        permission: "followups.view*",
      },
      {
        id: "comm-follow-ups",
        label: "Follow Ups",
        href: "/communication/follow-ups",
        description: "Scheduled touchpoints & callbacks",
        icon: ArrowUpRight,
        permission: "followups.view*",
      },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    icon: Database,
    href: "/tools/import-leads",
    items: [
      {
        id: "tools-import",
        label: "Import Leads",
        href: "/tools/import-leads",
        description: "Bulk upload CSV, Excel or JSON lists",
        icon: UploadCloud,
        permission: "leads.create",
      },
      {
        id: "tools-assign",
        label: "Assign Leads",
        href: "/tools/assign-leads",
        description: "Round-robin distribution & team routing",
        icon: UserCheck,
        permission: "leads.assign",
      },
      {
        id: "tools-data-mgmt",
        label: "Data Management",
        href: "/tools/data-management",
        description: "Cleanse, deduplicate and archive data",
        icon: Database,
        permission: "leads.delete*",
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: BarChart3,
    href: "/reports/leads",
    permission: "reports.view",
    items: [
      {
        id: "reports-leads",
        label: "Leads Reports",
        href: "/reports/leads",
        description: "Volume trends and pipeline conversions",
        icon: BarChart3,
        permission: "reports.view",
      },
      {
        id: "reports-call-reports",
        label: "Call Reports",
        href: "/reports/call-reports",
        description: "Call disposition & connection statistics",
        icon: Phone,
        permission: "reports.view",
      },
      {
        id: "reports-meetings",
        label: "Meeting Reports",
        href: "/reports/meeting-reports",
        description: "Show rates and executive presentation logs",
        icon: Video,
        permission: "reports.view",
      },
      {
        id: "reports-performance",
        label: "Performance",
        href: "/reports/performance",
        description: "Agent quota tracking and leaderboard",
        icon: TrendingUp,
        permission: "reports.view",
      },
      {
        id: "reports-ai-sales-intelligence",
        label: "AI Sales Intelligence",
        href: "/dashboard/ai-sales-intelligence",
        description: "Agent scorecards, sales coaching & lead priority",
        icon: Sparkles,
        permission: "reports.view",
      },
      {
        id: "reports-call-ingestion",
        label: "Call Ingestion",
        href: "/reports/call-ingestion",
        description: "PBX webhook feeds & AI recordings status",
        icon: Radio,
        permission: "reports.view",
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Sliders,
    href: "/settings/custom-fields",
    items: [
      {
        id: "settings-custom-fields",
        label: "Custom Fields",
        href: "/settings/custom-fields",
        description: "Create custom parameters & lead tags",
        icon: Sliders,
        permission: "settings.view",
      },
      {
        id: "settings-field-arrangement",
        label: "Field Arrangement",
        href: "/settings/field-arrangement",
        description: "Customize lead form layout and order",
        icon: Layers,
        permission: "settings.view",
      },
      {
        id: "settings-report-builder",
        label: "Report Builder",
        href: "/settings/report-builder",
        description: "Custom queries & automated report schedules",
        icon: FileSpreadsheet,
        permission: "reports.view",
      },
      {
        id: "settings-lead-feeds",
        label: "Lead Feeds",
        href: "/settings/lead-feeds",
        description: "Webhook endpoints and advertising APIs",
        icon: Rss,
        permission: "leadfeed.manage",
      },
      {
        id: "settings-message-templates",
        label: "Message Templates",
        href: "/settings/message-templates",
        description: "Email snippets and SMS follow-up macros",
        icon: MessageSquare,
        permission: "settings.view",
      },
      {
        id: "settings-staff",
        label: "Staff",
        href: "/settings/staff",
        description: "Sales representatives and seat allocations",
        icon: Shield,
        permission: "staff.view",
      },
      {
        id: "settings-roles",
        label: "Roles & Permissions",
        href: "/settings/roles",
        description: "Configure custom roles and granular permission scopes",
        icon: Shield,
        permission: "roles.manage",
      },
      {
        id: "settings-audit-log",
        label: "Audit Log",
        href: "/settings/audit-log",
        description: "Inspect chronological trail of security & CRM actions",
        icon: History,
        permission: "audit.view",
      },
      {
        id: "settings-do-not-record",
        label: "Do-Not-Record",
        href: "/settings/do-not-record",
        description: "Compliance list and restricted numbers",
        icon: PhoneOff,
        permission: "donotrecord.manage",
      },
      {
        id: "settings-ai-knowledge",
        label: "AI Knowledge & Profile",
        href: "/settings/ai-knowledge",
        description: "Business profile, products & AI knowledge base",
        icon: Sparkles,
        permission: "settings.manage",
      },
      {
        id: "settings-ai-receptionist",
        label: "AI Receptionist & Telephony",
        href: "/settings/ai-receptionist",
        description: "Cloud telephony routing, virtual numbers & AI call answering",
        icon: PhoneCall,
        permission: "integrations.manage",
      },
      {
        id: "settings-brochures",
        label: "Product Brochures",
        href: "/settings/brochures",
        description: "Global product PDF brochures for autonomous AI email dispatch",
        icon: FileText,
        permission: "settings.manage",
      },
      {
        id: "settings-email-integration",
        label: "Email & SMTP Integration",
        href: "/settings/email-integration",
        description: "Configure SMTP provider credentials, sender identity & templates",
        icon: Mail,
        permission: "settings.manage",
      },
      {
        id: "settings-workspaces",
        label: "Workspaces",
        href: "/settings/workspaces",
        description: "Manage projects, sub-accounts, staff memberships & routing",
        icon: Building2,
        permission: "roles.manage",
      },
    ],
  },
]

export function isCrmSidebarHiddenPath(pathname) {
  if (!pathname) return false
  return (
    pathname === "/" ||
    pathname.startsWith("/super-admin") ||
    pathname.startsWith("/portal/login") ||
    pathname === "/login"
  )
}

export function CrmMainWrapper({ children }) {
  const pathname = usePathname()
  const hasSidebar = !isCrmSidebarHiddenPath(pathname)

  return (
    <main className={`flex-1 w-full max-w-full min-w-0 ${hasSidebar ? "lg:pl-[260px]" : ""}`}>
      {children}
    </main>
  )
}

export default function Header() {
  const pathname = usePathname()
  const router = useRouter()

  // Unified Sidebar Navigation State
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [expandedCategory, setExpandedCategory] = useState(null)
  const [workspaceDropdownOpen, setWorkspaceDropdownOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [callbacksList, setCallbacksList] = useState([])
  const [callbackCounts, setCallbackCounts] = useState({ today: 0, overdue: 0, total: 0 })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  const workspaceRef = useRef(null)
  const notificationsRef = useRef(null)
  const profileRef = useRef(null)
  const searchInputRef = useRef(null)
  const lastAutoExpandedRef = useRef("")

  const {
    user: authUser,
    logout,
    setActiveTenant,
    checkAuth,
    hasPermission,
    workspaces,
    activeWorkspace,
    isMultiWorkspaceEnabled,
    setActiveWorkspace,
  } = useAuth()
  const { branding, isWhiteLabel } = useBranding()
  const [logoError, setLogoError] = useState(false)
  const user = authUser

  // Load and poll pending AI callbacks and reminders (standard tenant CRM routes only)
  useEffect(() => {
    let isMounted = true
    if (!pathname || isCrmSidebarHiddenPath(pathname)) {
      return
    }

    const loadCallbacks = async () => {
      try {
        if (!user) return
        if (user.role === "super_admin") return
        const [statsRes, listRes] = await Promise.all([
          apiClient.getFollowUpStats().catch(() => null),
          apiClient.getFollowUps({ status: "pending", limit: 5, sortBy: "scheduledAt", sortOrder: "asc" }).catch(() => null),
        ])
        if (!isMounted) return
        if (statsRes?.success && statsRes.data) {
          setCallbackCounts({
            today: statsRes.data.today || 0,
            overdue: statsRes.data.overdue || 0,
            total: (statsRes.data.today || 0) + (statsRes.data.overdue || 0),
          })
        }
        if (listRes?.success && listRes.data?.followUps) {
          setCallbacksList(listRes.data.followUps)
        }
      } catch (_) {}
    }

    loadCallbacks()
    const timer = setInterval(loadCallbacks, 60000)
    return () => {
      isMounted = false
      clearInterval(timer)
    }
  }, [user?.id, pathname])

  // Filter NAV_CATEGORIES dynamically based on user role and granular permissions
  const filteredNavCategories = useMemo(() => {
    if (!user) return []
    if (user.role === "super_admin") return NAV_CATEGORIES

    return NAV_CATEGORIES.map((cat) => {
      const permittedItems = (cat.items || []).filter((item) => {
        if (!item.permission) return true
        return typeof hasPermission === "function" ? hasPermission(item.permission) : true
      })

      if (cat.permission && typeof hasPermission === "function" && !hasPermission(cat.permission)) {
        return null
      }

      if (cat.items && cat.items.length > 0 && permittedItems.length === 0) {
        return null
      }

      const defaultHref = permittedItems.length > 0 ? permittedItems[0].href : cat.href

      return {
        ...cat,
        href: defaultHref,
        items: permittedItems,
      }
    }).filter(Boolean)
  }, [user, hasPermission])

  // Explicit action to exit active tenant and return to Super Admin Console
  const handleExitTenantContext = async () => {
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem("leadflow_active_tenant")
      }
      await apiClient.switchTenant(null).catch(() => {})
      if (typeof setActiveTenant === "function") {
        setActiveTenant(null)
      }
      if (typeof checkAuth === "function") {
        await checkAuth()
      }
      toast.success("Returned to Super Admin Console")
    } catch (_) {}
    router.push("/super-admin")
  }

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange)
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
    }
  }, [])

  // Close transient drawers/popovers on route change
  useEffect(() => {
    setMobileMenuOpen(false)
    setWorkspaceDropdownOpen(false)
    setNotificationsOpen(false)
    setProfileMenuOpen(false)
  }, [pathname])

  // Lock background page scroll while mobile slide-over sidebar is open (< 1024px)
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return

    const mql = window.matchMedia("(min-width: 1024px)")
    const handleViewportChange = (e) => {
      if (e.matches) {
        setMobileMenuOpen(false)
      }
    }
    mql.addEventListener?.("change", handleViewportChange)

    if (!mobileMenuOpen || mql.matches) {
      return () => {
        mql.removeEventListener?.("change", handleViewportChange)
      }
    }

    const prevOverflow = document.body.style.overflow
    const prevTouchAction = document.body.style.touchAction
    document.body.style.overflow = "hidden"
    document.body.style.touchAction = "none"

    return () => {
      document.body.style.overflow = prevOverflow
      document.body.style.touchAction = prevTouchAction
      mql.removeEventListener?.("change", handleViewportChange)
    }
  }, [mobileMenuOpen])

  // Close popovers on outside click, handle Escape and keyboard shortcut (Ctrl/Cmd + K)
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (workspaceRef.current && !workspaceRef.current.contains(event.target)) {
        setWorkspaceDropdownOpen(false)
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target)) {
        setNotificationsOpen(false)
      }
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setProfileMenuOpen(false)
      }
    }

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setWorkspaceDropdownOpen(false)
        setNotificationsOpen(false)
        setProfileMenuOpen(false)
        setMobileMenuOpen(false)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        if (typeof window !== "undefined" && window.innerWidth < 1024) {
          setMobileMenuOpen(true)
          setTimeout(() => {
            searchInputRef.current?.focus()
          }, 60)
        } else if (searchInputRef.current) {
          searchInputRef.current.focus()
        }
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {})
      }
    }
  }

  const handleGlobalSearch = (e) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      router.push(`/leads?search=${encodeURIComponent(searchQuery.trim())}`)
      setSearchQuery("")
      setMobileMenuOpen(false)
    }
  }

  const handleLogout = async () => {
    try {
      setProfileMenuOpen(false)
      setMobileMenuOpen(false)
      await logout()
    } catch (err) {
      console.error("Logout error:", err)
      toast.error("Logout failed. Please try again.")
    }
  }

  const isItemActive = (href) => {
    if (href === "/") return pathname === "/" || pathname === "/portal" || pathname === "/dashboard"
    if (href.includes("?status=")) {
      return (
        (pathname === "/leads" || pathname === "/portal/leads") &&
        typeof window !== "undefined" &&
        window.location.search.includes(href.split("?")[1])
      )
    }
    return pathname === href || pathname?.startsWith(`${href}/`)
  }

  const isCategoryActive = (category) => {
    if (category.id === "main") {
      return pathname === "/" || pathname === "/portal" || pathname === "/dashboard"
    }
    if (category.id === "leads") {
      return pathname?.startsWith("/leads") || pathname?.startsWith("/portal/leads")
    }
    if (pathname?.startsWith(`/${category.id}`)) return true
    return Boolean(category.items?.some((item) => isItemActive(item.href)))
  }

  const handleSelectWorkspace = (workspaceId) => {
    setActiveWorkspace(workspaceId)
    setWorkspaceDropdownOpen(false)
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("leadflow_workspace_changed", { detail: { workspaceId } }))
    }
    router.refresh()
  }

  // Keep active multi-item category expanded automatically on route entry / auth hydration
  useEffect(() => {
    const syncKey = `${pathname || ""}:${filteredNavCategories.length > 0 ? "ready" : "empty"}`
    if (lastAutoExpandedRef.current === syncKey) return
    lastAutoExpandedRef.current = syncKey

    const activeExpandable = filteredNavCategories.find(
      (cat) => cat.items && cat.items.length > 1 && isCategoryActive(cat)
    )
    if (activeExpandable) {
      setExpandedCategory(activeExpandable.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, filteredNavCategories])

  // Display user identity: actual authenticated user session details
  const userName = user?.name || user?.username || "Account Admin"
  const userEmail = user?.email || ""
  const userRole =
    user?.roleTitle ||
    (user?.role === "account_admin"
      ? "Leads Account Admin"
      : user?.role
      ? user.role.replace("_", " ").toUpperCase()
      : "Account Admin")
  const companyName = user?.account?.companyName || user?.account?.displayName || (user?.tenantId ? `Account ${user.tenantId}` : "")

  const userInitials = userName
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase() || "A"

  // Hide Client CRM sidebar on Super Admin console, login pages, or root entry router
  if (isCrmSidebarHiddenPath(pathname)) {
    return null
  }

  const renderBrandMark = ({ compact = false, onNavigate } = {}) => {
    const brandName =
      branding?.displayName && branding.displayName !== "LeadFlow"
        ? branding.displayName
        : isWhiteLabel
        ? companyName || "CRM"
        : "LEADS365"

    return (
      <Link
        href="/"
        onClick={onNavigate}
        className="flex-1 min-w-0 flex items-center gap-1.5 group"
        title={branding?.displayName || companyName || "CRM Home"}
      >
        {branding?.logoUrl && !logoError ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={branding.logoUrl}
            alt={branding.displayName || companyName || "Logo"}
            onError={() => setLogoError(true)}
            className={`${compact ? "h-7 w-auto max-w-[110px]" : "h-auto max-h-7 w-auto max-w-[76px]"} object-contain shrink-0 drop-shadow-2xs transition-transform group-hover:scale-105 duration-200`}
          />
        ) : (
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm group-hover:scale-105 transition-all duration-200 shrink-0"
            style={{
              backgroundColor: branding?.primaryColor || branding?.brandPrimaryColor || "#4f46e5",
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.2}
                d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
              />
            </svg>
          </div>
        )}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <span className="font-extrabold text-slate-900 text-sm tracking-tight group-hover:text-indigo-600 transition-colors truncate min-w-0">
            {brandName}
          </span>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider border shrink-0"
            style={{
              backgroundColor: branding?.primaryColor ? `${branding.primaryColor}15` : "#eef2ff",
              color: branding?.primaryColor || "#4338ca",
              borderColor: branding?.primaryColor ? `${branding.primaryColor}30` : "#c7d2fe",
            }}
          >
            CRM
          </span>
        </div>
      </Link>
    )
  }

  const selectedWorkspaceObj = workspaces?.find((w) => w._id?.toString() === activeWorkspace)

  return (
    <>
      {/* =========================================================================
          MOBILE / TABLET COMPACT TRIGGER BAR (< 1024px ONLY — No duplicated nav items)
      ========================================================================= */}
      <header className="sticky top-0 z-30 lg:hidden bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-2xs select-none w-full">
        <div className="px-3 sm:px-4 h-14 flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center space-x-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open CRM Navigation"
              aria-expanded={mobileMenuOpen}
              aria-controls="crm-sidebar"
              className="p-2 -ml-1 rounded-lg text-slate-700 hover:text-slate-900 hover:bg-slate-100 focus:outline-none cursor-pointer shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            {renderBrandMark({ compact: true })}
          </div>
        </div>
      </header>

      {/* Mobile / Tablet Drawer Backdrop (< 1024px) */}
      <div
        onClick={() => setMobileMenuOpen(false)}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-xs lg:hidden transition-opacity duration-200 ${
          mobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* =========================================================================
          UNIFIED PERMANENT LEFT SIDEBAR (260px Fixed on >= 1024px, Drawer on < 1024px)
      ========================================================================= */}
      <aside
        id="crm-sidebar"
        aria-label="CRM Sidebar Navigation"
        className={`fixed inset-y-0 left-0 z-50 lg:z-40 w-[260px] max-w-[86vw] lg:max-w-[260px] h-[100dvh] bg-white border-r border-slate-200/90 shadow-2xl lg:shadow-xs flex flex-col select-none transition-transform duration-200 ease-out ${
          mobileMenuOpen
            ? "translate-x-0 visible pointer-events-auto"
            : "-translate-x-full invisible pointer-events-none lg:translate-x-0 lg:visible lg:pointer-events-auto"
        }`}
      >
        {/* -----------------------------------------------------------------------
            TOP SECTION: Branding + Workspace Selector + Global Search
        ----------------------------------------------------------------------- */}
        <div className="shrink-0 border-b border-slate-100 bg-white">
          {/* Logo & Utility Buttons */}
          <div className="px-3 pt-3.5 pb-2.5 flex items-center justify-between gap-1.5 min-w-0">
            {renderBrandMark({ onNavigate: () => setMobileMenuOpen(false) })}

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                aria-label="Toggle Fullscreen"
                className="hidden lg:inline-flex p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none cursor-pointer"
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close CRM Navigation"
                className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Super Admin Active Tenant Indicator */}
          {user?.role === "super_admin" && !isWhiteLabel && (
            <div className="px-3.5 pb-2.5">
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200/80 text-[11px] shadow-2xs">
                <div className="flex items-center space-x-1 min-w-0">
                  <span className="font-bold text-indigo-700 shrink-0">Tenant:</span>
                  <span className="text-slate-800 font-semibold truncate" title={companyName}>
                    {companyName || user?.tenantId || "Active"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleExitTenantContext}
                  className="text-indigo-600 hover:text-indigo-900 font-bold hover:underline shrink-0 cursor-pointer"
                  title="Exit to Super Admin Console"
                >
                  Console
                </button>
              </div>
            </div>
          )}

          {/* Workspace Selector */}
          {isMultiWorkspaceEnabled && workspaces && workspaces.length > 0 && (
            <div className="px-3.5 pb-2.5 relative" ref={workspaceRef}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                CRM Workspace
              </p>
              <button
                type="button"
                onClick={() => {
                  setWorkspaceDropdownOpen((prev) => !prev)
                  setNotificationsOpen(false)
                  setProfileMenuOpen(false)
                }}
                aria-expanded={workspaceDropdownOpen}
                title="Switch active project/workspace"
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-xs font-semibold rounded-lg bg-slate-50/90 hover:bg-slate-100 text-slate-800 border border-slate-200/90 shadow-2xs transition-colors cursor-pointer"
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <Building2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span className="truncate">
                    {activeWorkspace === "all"
                      ? `All Projects (${workspaces.length})`
                      : selectedWorkspaceObj?.name || "Select Workspace"}
                  </span>
                </div>
                <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>

              {workspaceDropdownOpen && (
                <div className="absolute left-3.5 right-3.5 top-full -mt-1 bg-white rounded-xl shadow-xl border border-slate-200/95 py-1.5 z-30">
                  <div className="px-3 py-1.5 border-b border-slate-100">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Project / Workspace
                    </p>
                  </div>

                  {(user?.role === "account_admin" || user?.role === "super_admin") && (
                    <button
                      type="button"
                      onClick={() => handleSelectWorkspace("all")}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-slate-50 transition-colors cursor-pointer ${
                        activeWorkspace === "all" ? "bg-indigo-50/80 text-indigo-700 font-semibold" : "text-slate-700"
                      }`}
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <Layers className="w-4 h-4 text-indigo-600 shrink-0" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">All Projects</p>
                          <p className="text-[10px] text-slate-400">Consolidated Master View</p>
                        </div>
                      </div>
                      {activeWorkspace === "all" && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                    </button>
                  )}

                  <div className="max-h-56 overflow-y-auto py-1">
                    {workspaces.map((ws) => {
                      const wsId = ws._id?.toString()
                      const isSelected = activeWorkspace === wsId
                      return (
                        <button
                          key={ws._id}
                          type="button"
                          onClick={() => handleSelectWorkspace(wsId)}
                          className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-slate-50 transition-colors cursor-pointer ${
                            isSelected ? "bg-indigo-50/80 text-indigo-700 font-semibold" : "text-slate-700"
                          }`}
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <div
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: ws.branding?.primaryColor || "#4f46e5" }}
                            />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{ws.name}</p>
                              <p className="text-[10px] text-slate-400 truncate">
                                {ws.slug} {ws.userRole ? `• ${ws.userRole}` : ""}
                              </p>
                            </div>
                          </div>
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                        </button>
                      )
                    })}
                  </div>

                  {(user?.role === "account_admin" || user?.role === "super_admin") && (
                    <div className="border-t border-slate-100 pt-1 mt-1 px-1">
                      <Link
                        href="/settings/workspaces"
                        onClick={() => {
                          setWorkspaceDropdownOpen(false)
                          setMobileMenuOpen(false)
                        }}
                        className="flex items-center space-x-1.5 px-2.5 py-1.5 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50/60 rounded-lg font-medium transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Manage Workspaces</span>
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Global Search */}
          <div className="px-3.5 pb-3">
            <form onSubmit={handleGlobalSearch} className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search leads..."
                aria-label="Global Search"
                className="w-full pl-8 pr-11 py-2 text-xs bg-slate-50/90 hover:bg-slate-100/70 focus:bg-white text-slate-800 placeholder-slate-400 border border-slate-200/90 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs transition-colors"
              />
              <kbd className="hidden lg:inline-flex items-center text-[10px] font-medium text-slate-400 bg-white border border-slate-200/90 rounded px-1.5 py-0.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none shadow-2xs">
                ⌘K
              </kbd>
            </form>
          </div>
        </div>

        {/* -----------------------------------------------------------------------
            NAVIGATION SECTION: Independently Scrollable CRM Menu & Submenus
        ----------------------------------------------------------------------- */}
        <nav
          aria-label="Primary CRM Navigation"
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2.5 space-y-1 [scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent]"
        >
          {filteredNavCategories.map((category) => {
            const CategoryIcon = category.icon
            const isExpanded = expandedCategory === category.id
            const isCatActive = isCategoryActive(category)
            const hasChildren = category.items.length > 1

            if (!hasChildren) {
              return (
                <Link
                  key={category.id}
                  href={category.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-[13px] font-semibold transition-colors ${
                    isCatActive
                      ? "bg-indigo-50 text-indigo-700 border border-indigo-200/60"
                      : "text-slate-700 hover:bg-slate-50 hover:text-slate-900 border border-transparent"
                  }`}
                >
                  <CategoryIcon
                    className={`w-4 h-4 shrink-0 ${isCatActive ? "text-indigo-600" : "text-slate-400"}`}
                  />
                  <span className="truncate">{category.label}</span>
                </Link>
              )
            }

            return (
              <div key={category.id} className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => setExpandedCategory(isExpanded ? null : category.id)}
                  aria-expanded={isExpanded}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer ${
                    isCatActive
                      ? "bg-indigo-50/70 text-indigo-700"
                      : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <CategoryIcon
                      className={`w-4 h-4 shrink-0 ${isCatActive ? "text-indigo-600" : "text-slate-400"}`}
                    />
                    <span className="truncate">{category.label}</span>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                </button>

                {isExpanded && (
                  <div className="pl-6 pr-1 py-0.5 space-y-0.5">
                    {category.items.map((item) => {
                      const ItemIcon = item.icon
                      const itemActive = isItemActive(item.href)

                      return (
                        <Link
                          key={item.id}
                          href={item.href}
                          onClick={() => setMobileMenuOpen(false)}
                          className={`flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors ${
                            itemActive
                              ? "bg-indigo-50 text-indigo-700 font-semibold"
                              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                          }`}
                        >
                          <ItemIcon
                            className={`w-3.5 h-3.5 shrink-0 ${itemActive ? "text-indigo-600" : "text-slate-400"}`}
                          />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* -----------------------------------------------------------------------
            BOTTOM SECTION: Notifications + User Profile + Super Admin Console + Sign Out
        ----------------------------------------------------------------------- */}
        <div className="shrink-0 border-t border-slate-200/80 bg-white px-3 py-2.5 space-y-1.5">
          {/* Notifications Trigger & Upward Popover */}
          <div className="relative" ref={notificationsRef}>
            {notificationsOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-30">
                <div className="px-3.5 py-2.5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-900 leading-snug">Callback Reminders</p>
                    <p className="text-[11px] text-slate-500">
                      {callbackCounts.today} today • {callbackCounts.overdue} overdue
                    </p>
                  </div>
                  <Link
                    href="/communication/follow-ups"
                    onClick={() => {
                      setNotificationsOpen(false)
                      setMobileMenuOpen(false)
                    }}
                    className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 shrink-0"
                  >
                    View all
                  </Link>
                </div>

                <div className="py-1 max-h-56 overflow-y-auto">
                  {callbacksList.length === 0 ? (
                    <div className="py-5 text-center text-slate-400">
                      <Clock className="w-5 h-5 mx-auto mb-1 text-slate-300" />
                      <p className="text-xs text-slate-500 font-medium">No pending callbacks</p>
                      <p className="text-[10px] text-slate-400">You&apos;re all caught up!</p>
                    </div>
                  ) : (
                    callbacksList.map((cb) => (
                      <Link
                        key={cb._id || cb.id}
                        href="/communication/follow-ups"
                        onClick={() => {
                          setNotificationsOpen(false)
                          setMobileMenuOpen(false)
                        }}
                        className="block px-3.5 py-2 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                      >
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <span className="text-xs font-semibold text-slate-900 truncate">
                            {cb.customerName || cb.lead?.name || cb.title}
                          </span>
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                              cb.isOverdue
                                ? "bg-red-100 text-red-700"
                                : cb.isToday
                                ? "bg-amber-100 text-amber-700"
                                : "bg-blue-100 text-blue-700"
                            }`}
                          >
                            {cb.isOverdue ? "Overdue" : cb.isToday ? "Today" : "Upcoming"}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 line-clamp-1">
                          {cb.notes || cb.callbackReason || "Scheduled follow-up"}
                        </p>
                        <p className="text-[10px] font-mono text-slate-400 mt-1">
                          {cb.scheduledAt
                            ? new Date(cb.scheduledAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })
                            : ""}
                        </p>
                      </Link>
                    ))
                  )}
                </div>

                <div className="px-3.5 py-2 border-t border-slate-100 text-center bg-slate-50/40">
                  <Link
                    href="/communication/follow-ups"
                    onClick={() => {
                      setNotificationsOpen(false)
                      setMobileMenuOpen(false)
                    }}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    Manage All Follow-ups & Callbacks →
                  </Link>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setNotificationsOpen((prev) => !prev)
                setProfileMenuOpen(false)
                setWorkspaceDropdownOpen(false)
              }}
              aria-expanded={notificationsOpen}
              aria-label="Scheduled Callbacks & Reminders"
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer ${
                notificationsOpen
                  ? "bg-indigo-50/70 text-indigo-700"
                  : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <div className="flex items-center space-x-3 min-w-0">
                <Bell
                  className={`w-4 h-4 shrink-0 ${notificationsOpen ? "text-indigo-600" : "text-slate-400"}`}
                />
                <span className="truncate">Notifications</span>
              </div>
              <div className="flex items-center space-x-1.5 shrink-0">
                {callbackCounts.total > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                    {callbackCounts.total}
                  </span>
                )}
                {notificationsOpen ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </div>
            </button>
          </div>

          {/* User Profile Menu + Direct Sign Out */}
          <div className="relative" ref={profileRef}>
            {profileMenuOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 max-h-[52vh] overflow-y-auto z-30">
                <div className="px-3.5 py-2 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-900 leading-snug truncate">{userName}</p>
                  {userEmail && <p className="text-[11px] text-slate-500 font-mono truncate">{userEmail}</p>}
                  <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {userRole}
                    </span>
                    {companyName && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 truncate max-w-[180px]">
                        {companyName}
                      </span>
                    )}
                  </div>
                </div>

                <div className="py-1 text-xs text-slate-700">
                  {user?.role === "super_admin" && !isWhiteLabel && (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false)
                        setMobileMenuOpen(false)
                        handleExitTenantContext()
                      }}
                      className="w-full text-left flex items-center space-x-2.5 px-3.5 py-2 hover:bg-indigo-50 text-indigo-700 font-semibold transition-colors border-b border-slate-100 cursor-pointer"
                    >
                      <Building2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <span>Super Admin Console</span>
                    </button>
                  )}
                  <Link
                    href="/settings/staff"
                    onClick={() => {
                      setProfileMenuOpen(false)
                      setMobileMenuOpen(false)
                    }}
                    className="flex items-center space-x-2.5 px-3.5 py-2 hover:bg-slate-50 transition-colors"
                  >
                    <Shield className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>Staff & Team Profile</span>
                  </Link>
                  <Link
                    href="/settings/custom-fields"
                    onClick={() => {
                      setProfileMenuOpen(false)
                      setMobileMenuOpen(false)
                    }}
                    className="flex items-center space-x-2.5 px-3.5 py-2 hover:bg-slate-50 transition-colors"
                  >
                    <Sliders className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>Custom Fields & Tags</span>
                  </Link>
                </div>

                <div className="pt-1.5 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center space-x-2.5 px-3.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen((prev) => !prev)
                  setNotificationsOpen(false)
                  setWorkspaceDropdownOpen(false)
                }}
                aria-expanded={profileMenuOpen}
                aria-label="Account Profile"
                className="flex-1 min-w-0 flex items-center justify-between gap-2 p-1.5 rounded-xl hover:bg-slate-50 transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 via-indigo-700 to-purple-600 text-white font-bold text-xs flex items-center justify-center shadow-xs shrink-0">
                    {userInitials}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">{userName}</p>
                    <p className="text-[11px] text-slate-500 truncate">{companyName || userRole}</p>
                  </div>
                </div>
                <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>

              <button
                type="button"
                onClick={handleLogout}
                title="Sign Out"
                aria-label="Sign Out"
                className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Persistent In-App Follow-up & Callback Alarms */}
      <FollowUpAlertManager />
    </>
  )
}
