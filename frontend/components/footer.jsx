"use client"

import { usePathname } from "next/navigation"

export default function Footer() {
  const pathname = usePathname()
  if (pathname === "/" || pathname?.startsWith("/super-admin") || pathname?.startsWith("/portal") || pathname === "/login") {
    return null
  }
  return null
}
