"use client"

import React, { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
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
  ChevronRight,
  Menu,
  X,
  Plus,
} from "lucide-react"

// Complete Six-Category CRM Navigation Structure (All 26 child items preserved)
const NAV_CATEGORIES = [
  {
    id: "main",
    label: "Home",
    icon: LayoutDashboard,
    href: "/",
    items: [
      {
        id: "main-dashboard",
        label: "Home",
        href: "/",
        description: "Pipeline KPIs, metrics & lead velocity",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    id: "leads",
    label: "Leads",
    icon: Users,
    href: "/leads",
    items: [
      {
        id: "leads-all",
        label: "All Leads",
        href: "/leads",
        description: "Complete database of sales inquiries",
        icon: Users,
      },
      {
        id: "leads-new",
        label: "New Leads",
        href: "/leads?status=New",
        description: "Fresh prospects awaiting initial contact",
        icon: Sparkles,
        badge: "New",
      },
      {
        id: "leads-active",
        label: "Active Leads",
        href: "/leads?status=Engaged",
        description: "Discussions & proposals in progress",
        icon: Activity,
      },
      {
        id: "leads-order-placed",
        label: "Order Placed",
        href: "/leads?status=Closed-Won",
        description: "Successfully converted deals",
        icon: CheckCircle2,
      },
      {
        id: "leads-lost",
        label: "Lost Leads",
        href: "/leads?status=Closed-Lost",
        description: "Closed or lost opportunity records",
        icon: XCircle,
      },
      {
        id: "leads-add-new",
        label: "Add New Lead",
        href: "/leads/new",
        description: "Create and register a new sales lead",
        icon: UserPlus,
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
      },
      {
        id: "comm-meetings",
        label: "Meetings",
        href: "/communication/meetings",
        description: "Scheduled client demos and briefings",
        icon: Calendar,
      },
      {
        id: "comm-reminders",
        label: "Reminders",
        href: "/communication/reminders",
        description: "Pending tasks and time-sensitive alerts",
        icon: Clock,
      },
      {
        id: "comm-follow-ups",
        label: "Follow Ups",
        href: "/communication/follow-ups",
        description: "Scheduled touchpoints & callbacks",
        icon: ArrowUpRight,
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
      },
      {
        id: "tools-assign",
        label: "Assign Leads",
        href: "/tools/assign-leads",
        description: "Round-robin distribution & team routing",
        icon: UserCheck,
      },
      {
        id: "tools-data-mgmt",
        label: "Data Management",
        href: "/tools/data-management",
        description: "Cleanse, deduplicate and archive data",
        icon: Database,
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: BarChart3,
    href: "/reports/leads",
    items: [
      {
        id: "reports-leads",
        label: "Leads Reports",
        href: "/reports/leads",
        description: "Volume trends and pipeline conversions",
        icon: BarChart3,
      },
      {
        id: "reports-call-reports",
        label: "Call Reports",
        href: "/reports/call-reports",
        description: "Call disposition & connection statistics",
        icon: Phone,
      },
      {
        id: "reports-meetings",
        label: "Meeting Reports",
        href: "/reports/meeting-reports",
        description: "Show rates and executive presentation logs",
        icon: Video,
      },
      {
        id: "reports-performance",
        label: "Performance",
        href: "/reports/performance",
        description: "Agent quota tracking and leaderboard",
        icon: TrendingUp,
      },
      {
        id: "reports-call-ingestion",
        label: "Call Ingestion",
        href: "/reports/call-ingestion",
        description: "PBX webhook feeds & AI recordings status",
        icon: Radio,
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
      },
      {
        id: "settings-field-arrangement",
        label: "Field Arrangement",
        href: "/settings/field-arrangement",
        description: "Customize lead form layout and order",
        icon: Layers,
      },
      {
        id: "settings-report-builder",
        label: "Report Builder",
        href: "/settings/report-builder",
        description: "Custom queries & automated report schedules",
        icon: FileSpreadsheet,
      },
      {
        id: "settings-lead-feeds",
        label: "Lead Feeds",
        href: "/settings/lead-feeds",
        description: "Webhook endpoints and advertising APIs",
        icon: Rss,
      },
      {
        id: "settings-message-templates",
        label: "Message Templates",
        href: "/settings/message-templates",
        description: "Email snippets and SMS follow-up macros",
        icon: MessageSquare,
      },
      {
        id: "settings-staff",
        label: "Staff",
        href: "/settings/staff",
        description: "Sales representatives and seat allocations",
        icon: Shield,
      },
      {
        id: "settings-roles",
        label: "Roles & Permissions",
        href: "/settings/roles",
        description: "Configure custom roles and granular permission scopes",
        icon: Shield,
      },
      {
        id: "settings-audit-log",
        label: "Audit Log",
        href: "/settings/audit-log",
        description: "Inspect chronological trail of security & CRM actions",
        icon: History,
      },
      {
        id: "settings-do-not-record",
        label: "Do-Not-Record",
        href: "/settings/do-not-record",
        description: "Compliance list and restricted numbers",
        icon: PhoneOff,
      },
    ],
  },
]

export default function Header() {
  const pathname = usePathname()
  const router = useRouter()

  // State
  const [activeDropdown, setActiveDropdown] = useState(null)
  const [dropdownCoords, setDropdownCoords] = useState({ top: 0, left: 0 })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [expandedMobileCategory, setExpandedMobileCategory] = useState(null)
  const [userDropdownOpen, setUserDropdownOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const { user: authUser, logout } = useAuth()
  const user = authUser?.role === "account_admin" ? authUser : null

  const dropdownTimeoutRef = useRef(null)
  const navRef = useRef(null)
  const categoryButtonRefs = useRef({})
  const searchInputRef = useRef(null)

  // Redirect Super Admin if they access Client CRM
  useEffect(() => {
    if (authUser?.role === "super_admin") {
      router.replace("/super-admin")
    }
  }, [authUser, router])

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

  // Close menus on path change
  useEffect(() => {
    setActiveDropdown(null)
    setMobileMenuOpen(false)
    setUserDropdownOpen(false)
  }, [pathname])

  // Close menus on outside click, handle Escape and keyboard shortcut (Ctrl/Cmd + K)
  useEffect(() => {
    const handleClickOutside = (event) => {
      const dropdownEl = document.getElementById("navbar-category-dropdown")
      const isInsideDropdown = dropdownEl && dropdownEl.contains(event.target)
      if (navRef.current && !navRef.current.contains(event.target) && !isInsideDropdown) {
        setActiveDropdown(null)
        setUserDropdownOpen(false)
      }
    }

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setActiveDropdown(null)
        setUserDropdownOpen(false)
        setMobileMenuOpen(false)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        if (searchInputRef.current) {
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

  // Dynamic dropdown repositioning on scroll/resize
  useEffect(() => {
    const handleScrollOrResize = () => {
      if (activeDropdown) {
        const buttonEl = categoryButtonRefs.current[activeDropdown]
        if (buttonEl) {
          const rect = buttonEl.getBoundingClientRect()
          const dropdownWidth = 288
          let left = rect.left
          if (left + dropdownWidth > window.innerWidth - 16) {
            left = window.innerWidth - dropdownWidth - 16
          }
          if (left < 16) left = 16
          setDropdownCoords({
            top: Math.round(rect.bottom + 6),
            left: Math.round(left),
          })
        }
      }
    }
    window.addEventListener("scroll", handleScrollOrResize, { passive: true })
    window.addEventListener("resize", handleScrollOrResize, { passive: true })
    return () => {
      window.removeEventListener("scroll", handleScrollOrResize)
      window.removeEventListener("resize", handleScrollOrResize)
    }
  }, [activeDropdown])

  // Dropdown open/leave handlers with generous hover bridge
  const handleOpenDropdown = (categoryId) => {
    if (dropdownTimeoutRef.current) {
      clearTimeout(dropdownTimeoutRef.current)
      dropdownTimeoutRef.current = null
    }

    const buttonEl = categoryButtonRefs.current[categoryId]
    if (buttonEl) {
      const rect = buttonEl.getBoundingClientRect()
      const dropdownWidth = 288
      let left = rect.left
      if (left + dropdownWidth > window.innerWidth - 16) {
        left = window.innerWidth - dropdownWidth - 16
      }
      if (left < 16) left = 16
      setDropdownCoords({
        top: Math.round(rect.bottom + 6),
        left: Math.round(left),
      })
    }
    setActiveDropdown(categoryId)
    setUserDropdownOpen(false)
  }

  const handleDropdownLeave = () => {
    if (dropdownTimeoutRef.current) {
      clearTimeout(dropdownTimeoutRef.current)
    }
    dropdownTimeoutRef.current = setTimeout(() => {
      setActiveDropdown(null)
    }, 220)
  }

  const handleDropdownEnter = () => {
    if (dropdownTimeoutRef.current) {
      clearTimeout(dropdownTimeoutRef.current)
      dropdownTimeoutRef.current = null
    }
  }

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
      setUserDropdownOpen(false)
      await logout()
    } catch (err) {
      console.error("Logout error:", err)
      toast.error("Logout failed. Please try again.")
    }
  }

  const isCategoryActive = (category) => {
    if (category.id === "main") {
      return pathname === "/" || pathname === "/portal" || pathname === "/dashboard"
    }
    if (category.id === "leads") {
      return pathname?.startsWith("/leads") || pathname?.startsWith("/portal/leads")
    }
    return pathname?.startsWith(`/${category.id}`)
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
    return pathname === href
  }

  // Display user identity: actual authenticated user session details
  const userName = user?.name || user?.username || "Account Admin"
  const userEmail = user?.email || ""
  const userRole = user?.roleTitle || (user?.role === "account_admin" ? "Leads Account Admin" : "Account Admin")
  const companyName = user?.account?.companyName || user?.account?.displayName || (user?.tenantId ? `Account ${user.tenantId}` : "")

  const userInitials = userName
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase() || "A"

  // Hide Client CRM header on Super Admin console or login pages
  if (
    pathname?.startsWith("/super-admin") ||
    pathname?.startsWith("/portal/login") ||
    pathname === "/login"
  ) {
    return null
  }

  const activeCategoryData = NAV_CATEGORIES.find((c) => c.id === activeDropdown)

  return (
    <header
      ref={navRef}
      className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-2xs select-none transition-colors"
    >
      <div className="max-w-[1600px] mx-auto px-3 sm:px-4 lg:px-6">
        <div className="flex items-center justify-between h-16 gap-2 sm:gap-4 lg:gap-6">
          
          {/* =========================================================================
              LEFT SECTION: Brand Logo + Spacious, Left-positioned Search Bar
          ========================================================================= */}
          <div className="flex items-center space-x-3 sm:space-x-4 lg:space-x-5 min-w-0">
            {/* Brand Logo & Name */}
            <Link
              href="/"
              className="flex items-center space-x-2.5 group shrink-0"
              title="LeadFlow CRM Home"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-100 group-hover:scale-105 transition-all duration-200">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.2}
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                  />
                </svg>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="font-extrabold text-slate-900 text-base tracking-tight group-hover:text-indigo-600 transition-colors">
                  LeadFlow
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm bg-indigo-50 text-indigo-700 border border-indigo-200/60 uppercase tracking-wider">
                  CRM
                </span>
              </div>
            </Link>

            {/* Spacious Search Bar — Positioned to the left, generous responsive width */}
            <form
              onSubmit={handleGlobalSearch}
              className="relative w-36 sm:w-48 md:w-52 lg:w-64 xl:w-80 shrink transition-all duration-200"
            >
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none transition-colors" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search leads..."
                className="w-full pl-9 pr-8 py-1.5 text-xs bg-slate-50/90 hover:bg-slate-100/70 focus:bg-white text-slate-800 placeholder-slate-400 border border-slate-200/90 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs transition-all duration-200"
              />
              <div className="hidden xl:flex items-center absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <kbd className="text-[10px] font-medium text-slate-400 bg-white border border-slate-200/90 rounded px-1.5 py-0.5 shadow-2xs">
                  ⌘K
                </kbd>
              </div>
            </form>
          </div>

          {/* =========================================================================
              CENTER: ALL PRIMARY NAVIGATION ITEMS IN ONE NAVBAR (NO ARROWS, NO SCROLL)
          ========================================================================= */}
          <nav className="hidden md:flex items-center space-x-0.5 lg:space-x-1 xl:space-x-1.5 shrink-0">
            {NAV_CATEGORIES.map((category) => {
              const CategoryIcon = category.icon
              const isActive = isCategoryActive(category)
              const isDropdownOpen = activeDropdown === category.id
              const hasDropdown = category.items.length > 1

              return (
                <div
                  key={category.id}
                  className="relative shrink-0"
                  onMouseEnter={() => {
                    if (hasDropdown) handleOpenDropdown(category.id)
                  }}
                  onMouseLeave={() => {
                    if (hasDropdown) handleDropdownLeave()
                  }}
                >
                  <button
                    type="button"
                    ref={(el) => (categoryButtonRefs.current[category.id] = el)}
                    onClick={() => {
                      if (!hasDropdown) {
                        setActiveDropdown(null)
                        router.push(category.href)
                      } else {
                        if (isDropdownOpen) {
                          setActiveDropdown(null)
                        } else {
                          handleOpenDropdown(category.id)
                        }
                      }
                    }}
                    className={`flex items-center space-x-1.5 px-2.5 py-1.5 lg:px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-150 focus:outline-none cursor-pointer ${
                      isActive || isDropdownOpen
                        ? "bg-indigo-50/80 text-indigo-700 shadow-2xs border border-indigo-200/80"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 border border-transparent"
                    }`}
                  >
                    <CategoryIcon
                      className={`w-3.5 h-3.5 transition-colors ${
                        isActive || isDropdownOpen ? "text-indigo-600" : "text-slate-400"
                      }`}
                    />
                    <span>{category.label}</span>
                    {hasDropdown && (
                      <ChevronDown
                        className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${
                          isDropdownOpen ? "rotate-180 text-indigo-600" : ""
                        }`}
                      />
                    )}
                  </button>
                </div>
              )
            })}
          </nav>

          {/* =========================================================================
              RIGHT SECTION: Fullscreen & User Profile (Standalone Plus & Settings Removed)
          ========================================================================= */}
          <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
            {/* Fullscreen Toggle */}
            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
              aria-label="Toggle Fullscreen"
              className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors focus:outline-none cursor-pointer"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>

            {/* User Profile Avatar */}
            <div className="relative pl-1">
              <button
                type="button"
                onClick={() => {
                  setUserDropdownOpen(!userDropdownOpen)
                  setActiveDropdown(null)
                }}
                title="Account Profile"
                aria-label="Account Profile"
                className="flex items-center rounded-full p-0.5 hover:ring-2 hover:ring-indigo-400/50 transition-all focus:outline-none cursor-pointer"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 via-indigo-700 to-purple-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                  {userInitials}
                </div>
              </button>

              {/* Profile Dropdown */}
              {userDropdownOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-200 py-2.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="px-4 py-2.5 border-b border-slate-100">
                    <p className="text-xs font-bold text-slate-900 leading-snug">{userName}</p>
                    {userEmail && (
                      <p className="text-[11px] text-slate-500 font-mono truncate">{userEmail}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5 items-center">
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
                    <Link
                      href="/settings/staff"
                      onClick={() => setUserDropdownOpen(false)}
                      className="flex items-center space-x-2.5 px-4 py-2 hover:bg-slate-50 transition-colors"
                    >
                      <Shield className="w-3.5 h-3.5 text-slate-400" />
                      <span>Staff & Team Profile</span>
                    </Link>
                    <Link
                      href="/settings/custom-fields"
                      onClick={() => setUserDropdownOpen(false)}
                      className="flex items-center space-x-2.5 px-4 py-2 hover:bg-slate-50 transition-colors"
                    >
                      <Sliders className="w-3.5 h-3.5 text-slate-400" />
                      <span>Custom Fields & Tags</span>
                    </Link>
                  </div>

                  <div className="pt-1.5 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full flex items-center space-x-2.5 px-4 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5 text-rose-500" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Mobile / Tablet Menu Button (Visible on screens < md) */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle CRM Menu"
              className="md:hidden p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus:outline-none ml-0.5 cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          SAFE FIXED-POSITION CATEGORY DROPDOWN MENU
          Max 4 items visible at a time with subtle vertical scrolling for overflow
      ========================================================================= */}
      {activeCategoryData && activeCategoryData.items.length > 1 && (
        <div
          id="navbar-category-dropdown"
          style={{
            position: "fixed",
            top: `${dropdownCoords.top}px`,
            left: `${dropdownCoords.left}px`,
            zIndex: 9999,
          }}
          className="w-72 bg-white rounded-xl shadow-xl border border-slate-200/90 py-1.5 animate-in fade-in slide-in-from-top-1 duration-150 before:content-[''] before:absolute before:-top-3 before:left-0 before:right-0 before:h-3"
          onMouseEnter={handleDropdownEnter}
          onMouseLeave={handleDropdownLeave}
        >
          {/* Stable Header */}
          <div className="px-3.5 py-2 mb-1 border-b border-slate-100 flex items-center justify-between bg-slate-50/60 rounded-t-lg select-none">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {activeCategoryData.label}
            </span>
            <span className="text-[10px] text-slate-400 font-medium">
              {activeCategoryData.items.length} items
            </span>
          </div>

          {/* Max 4 items visible, scrollable if more */}
          <div className="px-1.5 py-0.5 space-y-0.5 max-h-[224px] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-track]:bg-transparent">
            {activeCategoryData.items.map((item) => {
              const ItemIcon = item.icon
              const itemActive = isItemActive(item.href)

              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={() => setActiveDropdown(null)}
                  className={`flex items-start space-x-2.5 p-2 rounded-lg text-xs transition-colors group ${
                    itemActive
                      ? "bg-indigo-50/90 text-indigo-900 font-semibold"
                      : "text-slate-700 hover:bg-slate-50 hover:text-indigo-600"
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                      itemActive
                        ? "bg-indigo-600 text-white shadow-2xs"
                        : "bg-slate-100 text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-600"
                    }`}
                  >
                    <ItemIcon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-1.5">
                      <span className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors truncate">
                        {item.label}
                      </span>
                      {item.badge && (
                        <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded-full bg-indigo-100 text-indigo-700">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-1 leading-normal">
                      {item.description}
                    </p>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* =========================================================================
          MOBILE NAVIGATION DRAWER
      ========================================================================= */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden animate-in fade-in duration-200">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Drawer content */}
          <div className="fixed inset-y-0 right-0 w-84 max-w-[85vw] bg-white shadow-2xl flex flex-col z-50 border-l border-slate-200">
            {/* Drawer Header */}
            <div className="h-16 px-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center font-bold text-xs">
                  LF
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900">LeadFlow CRM</h3>
                  <p className="text-[10px] text-slate-400">All 6 CRM Categories</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mobile Search */}
            <div className="p-3 border-b border-slate-100">
              <form onSubmit={handleGlobalSearch} className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search leads..."
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </form>
            </div>

            {/* Scrollable Categories List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {NAV_CATEGORIES.map((category) => {
                const CategoryIcon = category.icon
                const isExpanded = expandedMobileCategory === category.id
                const isCatActive = isCategoryActive(category)
                const hasChildren = category.items.length > 1

                if (!hasChildren) {
                  return (
                    <Link
                      key={category.id}
                      href={category.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`w-full flex items-center justify-between p-2.5 rounded-xl text-xs font-bold transition-colors ${
                        isCatActive ? "text-indigo-700 bg-indigo-50/60" : "text-slate-800 hover:bg-slate-100"
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <CategoryIcon className="w-4 h-4 text-indigo-600" />
                        <span>{category.label}</span>
                      </div>
                    </Link>
                  )
                }

                return (
                  <div
                    key={category.id}
                    className="rounded-xl border border-slate-100 overflow-hidden bg-slate-50/40"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedMobileCategory(isExpanded ? null : category.id)
                      }
                      className={`w-full flex items-center justify-between p-2.5 text-xs font-bold transition-colors cursor-pointer ${
                        isCatActive ? "text-indigo-700 bg-indigo-50/50" : "text-slate-800 hover:bg-slate-100"
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <CategoryIcon className="w-4 h-4 text-indigo-600" />
                        <span>{category.label}</span>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <span className="text-[10px] text-slate-400">{category.items.length}</span>
                        <ChevronRight
                          className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                            isExpanded ? "rotate-90" : ""
                          }`}
                        />
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="bg-white px-2 py-1 space-y-0.5 border-t border-slate-100">
                        {category.items.map((item) => {
                          const ItemIcon = item.icon
                          const itemActive = isItemActive(item.href)

                          return (
                            <Link
                              key={item.id}
                              href={item.href}
                              onClick={() => setMobileMenuOpen(false)}
                              className={`flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                                itemActive
                                  ? "bg-indigo-50 text-indigo-700 font-semibold"
                                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                              }`}
                            >
                              <ItemIcon className="w-3.5 h-3.5 text-slate-400" />
                              <span>{item.label}</span>
                            </Link>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Mobile Drawer Footer */}
            <div className="p-3 border-t border-slate-100 bg-slate-50 space-y-2">
              <Link
                href="/leads/new"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full flex items-center justify-center space-x-1.5 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add New Lead</span>
              </Link>

              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center justify-center space-x-1.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-rose-200 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
