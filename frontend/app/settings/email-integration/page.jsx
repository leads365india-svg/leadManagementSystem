import EmailIntegrationClient from "./email-integration-client"

export const metadata = {
  title: "Email & SMTP Integration | Leads365 CRM",
  description: "Configure tenant-isolated SMTP email provider, sender identity, and test email connectivity.",
}

export default function EmailIntegrationPage() {
  return <EmailIntegrationClient />
}
