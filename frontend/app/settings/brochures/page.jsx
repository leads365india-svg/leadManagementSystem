import BrochuresClient from "./brochures-client"

export const metadata = {
  title: "Product Brochures Management | Leads365 CRM",
  description: "Manage tenant product PDF brochures and configure automatic AI email dispatch.",
}

export default function BrochuresPage() {
  return <BrochuresClient />
}
