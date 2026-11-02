import CustomFieldsClient from "./custom-fields-client"

export const metadata = {
  title: "Custom Fields Management | Leads365 CRM",
  description: "Configure tenant custom attributes, dropdown options, and website integration fields.",
}

export default function CustomFieldsPage() {
  return <CustomFieldsClient />
}
