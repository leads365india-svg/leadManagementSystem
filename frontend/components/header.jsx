"use client"

import React, { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
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
  PhoneOff,
  Search,
  Settings,
  Maximize,
  Minimize,
  LogOut,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Menu,
  X,
  Plus,
} from "lucide-react"

// Complete Six-Category CRM Navigation Structure (26 child items)
const NAV_CATEGORIES = [
  {
    id: "main",
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/",
    items: [
      {
        id: "main-dashboard",
        label: "Dashboard",
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
        id: "settings-do-not-record",
        label: "Do-Not-Record",
        href: "/settings/do-not-record",
        description: "Compliance list and restricted numbers",
        icon: PhoneOff,
      },
    ],
  },
]

// Dedicated Client CRM Settings List for Header Gear Popover
const CLIENT_SETTINGS = [
  { label: "Custom Fields", href: "/settings/custom-fields", icon: Sliders, desc: "Lead parameters & custom tags" },
  { label: "Field Arrangement", href: "/settings/field-arrangement", icon: Layers, desc: "Form layout & field ordering" },
  { label: "Report Builder", href: "/settings/report-builder", icon: FileSpreadsheet, desc: "Custom SQL & automated metrics" },
  { label: "Lead Feeds", href: "/settings/lead-feeds", icon: Rss, desc: "Webhook endpoints & advertising APIs" },
  { label: "Message Templates", href: "/settings/message-templates", icon: MessageSquare, desc: "SMS & Email follow-up macros" },
  { label: "Staff & Permissions", href: "/settings/staff", icon: Shield, desc: "Team members & role access" },
  { label: "Do-Not-Record List", href: "/settings/do-not-record", icon: PhoneOff, desc: "Compliance & restricted numbers" },
]

export default function Header() {
  const pathname = usePathname()
  const router = useRouter()

  // State
  const [activeDropdown, setActiveDropdown] = useState(null)
  const [dropdownCoords, setDropdownCoords] = useState({ top: 0, left: 0 })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [expandedMobileCategory, setExpandedMobileCategory] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [userDropdownOpen, setUserDropdownOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [user, setUser] = useState(null)

  const dropdownTimeoutRef = useRef(null)
  const navRef = useRef(null)
  const navScrollRef = useRef(null)
  const categoryButtonRefs = useRef({})
  const settingsRef = useRef(null)

  // Fetch current authenticated user details from session
  useEffect(() => {
    let isMounted = true
    const checkUser = async () => {
      try {
        const res = await apiClient.getMe()
        if (isMounted && res.success && res.data?.user) {
          const authUser = res.data.user
          // "If the current session belongs to a Super Admin, do not silently render it as a client Admin. Redirect it to its appropriate separate Super Admin area or show an access-denied page."
          if (authUser.role === "super_admin") {
            router.replace("/super-admin")
            return
          }
          if (authUser.role === "account_admin") {
            setUser(authUser)
          }
        }
      } catch (err) {
        // Unauthenticated or session expired
      }
    }
    checkUser()
    return () => {
      isMounted = false
    }
  }, [pathname, router])

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
    setSettingsOpen(false)
    setUserDropdownOpen(false)
  }, [pathname])

  // Close menus on outside click or escape
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setActiveDropdown(null)
        setSettingsOpen(false)
        setUserDropdownOpen(false)
      }
    }

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setActiveDropdown(null)
        setSettingsOpen(false)
        setUserDropdownOpen(false)
        setMobileMenuOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  // Smooth scroll handler for compact navigation container
  const scrollNav = (direction) => {
    if (navScrollRef.current) {
      const scrollAmount = direction === "left" ? -160 : 160
      navScrollRef.current.scrollBy({ left: scrollAmount, behavior: "smooth" })
    }
  }

  // Calculate safe fixed dropdown positioning to prevent clipping by overflow-x container
  const handleOpenDropdown = (categoryId) => {
    if (dropdownTimeoutRef.current) {
      clearTimeout(dropdownTimeoutRef.current)
    }

    const buttonEl = categoryButtonRefs.current[categoryId]
    if (buttonEl) {
      const rect = buttonEl.getBoundingClientRect()
      const dropdownWidth = 288
      let left = rect.left
      if (left + dropdownWidth > window.innerWidth - 16) {
        left = window.innerWidth - dropdownWidth - 16
      }
      setDropdownCoords({
        top: Math.round(rect.bottom + 6),
        left: Math.round(Math.max(12, left)),
      })
    }
    setActiveDropdown(categoryId)
  }

  const handleDropdownLeave = () => {
    dropdownTimeoutRef.current = setTimeout(() => {
      setActiveDropdown(null)
    }, 150)
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
      await apiClient.logout()
      toast.success("Signed out successfully")
    } catch (err) {
      console.error("Logout error:", err)
      toast.error("Logout failed. Please try again.")
    } finally {
      setUser(null)
      setUserDropdownOpen(false)
      router.push("/portal/login")
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

  // Display user identity: actual logged-in Admin's details from session, no hardcoded strings
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

  // Super Admin layout is completely separate - hide Client CRM header on /super-admin routes
  if (pathname?.startsWith("/super-admin")) {
    return null
  }

  const activeCategoryData = NAV_CATEGORIES.find((c) => c.id === activeDropdown)

  return (
    <header
      ref={navRef}
      className="sticky top-0 z-50 bg-white border-b border-slate-200/90 shadow-2xs select-none"
    >
      {/* =========================================================================
          ONE UNIFIED TOP HEADER ROW (64–72px height)
          Contains Logo, Search, compact 3-4 scrollable Categories, and icon buttons
      ========================================================================= */}
      <div className="max-w-[1600px] mx-auto px-3 sm:px-4 lg:px-6">
        <div className="flex items-center justify-between h-16 sm:h-17 gap-2 lg:gap-4">
          
          {/* LEFT: Brand Logo & App Name (links to Client CRM dashboard) */}
          <div className="flex items-center space-x-2 shrink-0">
            <Link
              href="/"
              className="flex items-center space-x-2.5 group"
              title="LeadFlow CRM Dashboard"
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
          </div>

          {/* CENTER: Compact Search Bar + Compact 3-4 Categories Navbar with Horizontal Overflow */}
          <div className="flex items-center space-x-2 lg:space-x-3 flex-1 min-w-0 justify-center">
            
            {/* Global Search Bar (Compact) */}
            <form onSubmit={handleGlobalSearch} className="relative w-32 sm:w-36 lg:w-44 shrink-0">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search leads..."
                className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 hover:bg-slate-100/70 focus:bg-white text-slate-800 placeholder-slate-400 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
              />
            </form>

            {/* Compact Navbar with Horizontal Overflow (Displays 3-4 categories at once) */}
            <div className="hidden md:flex items-center max-w-[340px] sm:max-w-[380px] lg:max-w-[440px] xl:max-w-[500px] shrink-0 border border-slate-200/60 rounded-xl px-1 py-0.5 bg-slate-50/50">
              {/* Left scroll button */}
              <button
                type="button"
                onClick={() => scrollNav("left")}
                className="shrink-0 p-1 text-slate-400 hover:text-slate-700 hover:bg-white rounded-md transition-colors"
                title="Scroll categories left"
                aria-label="Scroll left"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              {/* Scrollable categories container */}
              <nav
                ref={navScrollRef}
                onScroll={() => {
                  if (activeDropdown) setActiveDropdown(null)
                }}
                className="flex items-center space-x-1 overflow-x-auto scroll-smooth py-0.5 px-0.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
              >
                {NAV_CATEGORIES.map((category) => {
                  const CategoryIcon = category.icon
                  const isActive = isCategoryActive(category)
                  const isDropdownOpen = activeDropdown === category.id

                  return (
                    <div
                      key={category.id}
                      className="shrink-0"
                      onMouseEnter={() => handleOpenDropdown(category.id)}
                      onMouseLeave={handleDropdownLeave}
                    >
                      <button
                        type="button"
                        ref={(el) => (categoryButtonRefs.current[category.id] = el)}
                        onClick={() =>
                          isDropdownOpen ? setActiveDropdown(null) : handleOpenDropdown(category.id)
                        }
                        className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-150 focus:outline-none cursor-pointer ${
                          isActive || isDropdownOpen
                            ? "bg-white text-indigo-700 shadow-2xs border border-indigo-200/80"
                            : "text-slate-600 hover:text-slate-900 hover:bg-white/80"
                        }`}
                      >
                        <CategoryIcon
                          className={`w-3.5 h-3.5 ${
                            isActive || isDropdownOpen ? "text-indigo-600" : "text-slate-400"
                          }`}
                        />
                        <span>{category.label}</span>
                        <ChevronDown
                          className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${
                            isDropdownOpen ? "rotate-180 text-indigo-600" : ""
                          }`}
                        />
                      </button>
                    </div>
                  )
                })}
              </nav>

              {/* Right scroll button */}
              <button
                type="button"
                onClick={() => scrollNav("right")}
                className="shrink-0 p-1 text-slate-400 hover:text-slate-700 hover:bg-white rounded-md transition-colors"
                title="Scroll categories right"
                aria-label="Scroll right"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* RIGHT: Icon Buttons ONLY (Add Lead, Fullscreen, Single Functional Settings, Profile Avatar) */}
          <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
            
            {/* 1. Add Lead Icon Button (+) */}
            <Link
              href="/leads/new"
              title="Add New Lead"
              aria-label="Add New Lead"
              className="p-2 rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-xs hover:shadow-sm transition-all duration-150 active:scale-95 flex items-center justify-center"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
            </Link>

            {/* 2. Fullscreen Toggle Icon Button */}
            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
              aria-label="Toggle Fullscreen"
              className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors focus:outline-none"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>

            {/* 3. Settings Quick Icon with Dedicated Client Settings Popover */}
            <div className="relative" ref={settingsRef}>
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(!settingsOpen)
                  setUserDropdownOpen(false)
                  setActiveDropdown(null)
                }}
                title="Client CRM Settings"
                aria-label="Client CRM Settings"
                className={`p-2 rounded-lg transition-colors focus:outline-none ${
                  settingsOpen
                    ? "bg-indigo-50 text-indigo-600"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                }`}
              >
                <Settings className="w-4 h-4" />
              </button>

              {/* Client-scoped Settings Popover */}
              {settingsOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-200 py-2.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="px-4 py-2 border-b border-slate-100">
                    <p className="text-xs font-bold text-slate-900">Client CRM Settings</p>
                    <p className="text-[10px] text-slate-400">Configure lead forms, automation & team</p>
                  </div>
                  <div className="py-1 text-xs text-slate-700 max-h-80 overflow-y-auto">
                    {CLIENT_SETTINGS.map((item) => {
                      const ItemIcon = item.icon
                      const itemActive = pathname === item.href
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setSettingsOpen(false)}
                          className={`flex items-start space-x-2.5 px-4 py-2 hover:bg-slate-50 transition-colors ${
                            itemActive ? "bg-indigo-50/70 text-indigo-700 font-semibold" : ""
                          }`}
                        >
                          <ItemIcon className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-900 truncate">{item.label}</p>
                            <p className="text-[10px] text-slate-400 leading-tight">{item.desc}</p>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 4. User Profile / Avatar Icon Button (No text in header) */}
            <div className="relative pl-1">
              <button
                type="button"
                onClick={() => {
                  setUserDropdownOpen(!userDropdownOpen)
                  setSettingsOpen(false)
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

              {/* Profile Dropdown: Displays actual authenticated session details */}
              {userDropdownOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-200 py-2.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                  {/* Authenticated User & Account Details */}
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

                  {/* Profile Actions (Duplicate CRM Dashboard link removed) */}
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

                  {/* Sign Out Action */}
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
              className="md:hidden p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus:outline-none ml-0.5"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          SAFE FIXED-POSITION CATEGORY DROPDOWN MENU
          Rendered outside the scrollable container so it is NEVER clipped
      ========================================================================= */}
      {activeCategoryData && (
        <div
          style={{
            position: "fixed",
            top: `${dropdownCoords.top}px`,
            left: `${dropdownCoords.left}px`,
            zIndex: 9999,
          }}
          className="w-72 bg-white rounded-xl shadow-2xl border border-slate-200/90 py-2 animate-in fade-in slide-in-from-top-1 duration-150"
          onMouseEnter={() => {
            if (dropdownTimeoutRef.current) clearTimeout(dropdownTimeoutRef.current)
          }}
          onMouseLeave={handleDropdownLeave}
        >
          <div className="px-3 pb-2 mb-1 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {activeCategoryData.label}
            </span>
            <span className="text-[10px] text-slate-400 font-semibold">
              {activeCategoryData.items.length} items
            </span>
          </div>

          <div className="space-y-0.5 px-1.5 max-h-[70vh] overflow-y-auto">
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
                      ? "bg-indigo-50 text-indigo-900 font-semibold"
                      : "text-slate-700 hover:bg-slate-50 hover:text-indigo-600"
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                      itemActive
                        ? "bg-indigo-600 text-white"
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
          MOBILE NAVIGATION DRAWER (Phones & Small Tablets)
          Exposes all SIX categories and all 26 child items with no loss
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
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
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
                      className={`w-full flex items-center justify-between p-2.5 text-xs font-bold transition-colors ${
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

            {/* Mobile Drawer Footer with Quick Actions */}
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
                className="w-full flex items-center justify-center space-x-1.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-rose-200"
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
