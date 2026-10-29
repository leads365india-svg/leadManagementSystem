"use client"

import React from "react"
import Link from "next/link"
import { ArrowLeft, Clock, Sparkles, ChevronRight, LayoutDashboard, Users } from "lucide-react"

export default function CrmPlaceholderPage({
  title,
  category,
  description,
  badge = "Feature Coming Soon",
}) {
  return (
    <div className="min-h-[calc(100vh-140px)] bg-gradient-to-b from-slate-50 via-slate-50 to-indigo-50/20 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Breadcrumb */}
        <nav className="flex items-center space-x-2 text-xs text-slate-500">
          <Link href="/portal" className="hover:text-indigo-600 transition-colors flex items-center space-x-1">
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span>Home</span>
          </Link>
          <ChevronRight className="w-3 h-3 text-slate-400" />
          <span className="text-slate-600 font-medium">{category}</span>
          <ChevronRight className="w-3 h-3 text-slate-400" />
          <span className="text-indigo-600 font-semibold">{title}</span>
        </nav>

        {/* Header Hero Card */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-100">
            <div>
              <div className="flex items-center space-x-3 mb-2">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {category}
                </span>
                <span className="inline-flex items-center space-x-1 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  <Clock className="w-3 h-3" />
                  <span>{badge}</span>
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">{title}</h1>
              <p className="mt-2 text-sm text-slate-600 max-w-2xl leading-relaxed">
                {description ||
                  `The ${title} module is registered in the CRM navigation system and scheduled for full business logic implementation.`}
              </p>
            </div>

            <div className="flex items-center space-x-3 shrink-0">
              <Link
                href="/leads"
                className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <Users className="w-4 h-4" />
                <span>View Leads</span>
              </Link>
              <Link
                href="/portal"
                className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>CRM Dashboard</span>
              </Link>
            </div>
          </div>

          {/* Feature Preview Cards */}
          <div className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
              <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm mb-3">
                01
              </div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-1">Navbar Integrated</h4>
              <p className="text-xs text-slate-500">
                This endpoint is fully mapped in the CRM Top Navbar hierarchy.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-sm mb-3">
                02
              </div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-1">Safe Routing</h4>
              <p className="text-xs text-slate-500">
                Guaranteed zero 404 navigation errors across desktop and mobile menus.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
              <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center font-bold text-sm mb-3">
                <Sparkles className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-1">Backend Ready</h4>
              <p className="text-xs text-slate-500">
                Reserved API hooks and schemas ready for multi-tenant data binding.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
