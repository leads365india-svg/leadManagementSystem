import CallIngestionClient from "./call-ingestion-client"

export const metadata = {
  title: "Call Ingestion (Manual Upload) | Leads-365 CRM",
  description: "Ingest manual phone recordings and CSV call logs with automatic lead matching, Do-Not-Record guards, and a review queue.",
}

export default function CallIngestionPage() {
  return <CallIngestionClient />
}
