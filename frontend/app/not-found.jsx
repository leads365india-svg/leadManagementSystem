import Link from "next/link"

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center">
      <h2 className="text-3xl font-bold text-slate-900 mb-2">Page Not Found</h2>
      <p className="text-sm text-slate-500 mb-6 max-w-md">
        The requested CRM page could not be located or may have been moved.
      </p>
      <Link
        href="/"
        className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors"
      >
        Return to CRM Dashboard
      </Link>
    </div>
  )
}
