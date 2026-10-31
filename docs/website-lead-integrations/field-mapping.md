# Field Mapping Engine Guide

The **Leads-365 CRM Field Mapping Engine** allows external websites and webhooks to use arbitrary field names without requiring code changes on your website forms.

---

## 1. How Field Mapping Works

When an external form posts data, the Field Mapping Engine intercepts the payload:

1. Looks up the integration's registered `fieldMapping` rules.
2. Matches incoming keys (e.g. `full_name`, `mobile_number`, `client_inquiry`).
3. Applies configured data transforms (e.g. `lowercase`, `trim`, `phone_e164`).
4. Fallbacks to `defaultValue` if the incoming field is omitted or empty.
5. Populates CRM core lead fields (`name`, `email`, `phone`, `company`, `message`, `formId`).
6. Archives any custom fields (e.g. `productChoice`, `annualBudget`, `industry`) into `metadata.customFields`.

---

## 2. Standard Field Mapping Table

| Incoming Form Field | CRM Target Field | Recommended Transform | Description |
|---|---|---|---|
| `full_name`, `contact_name` | `name` | `trim` | Visitor's full name |
| `email_address`, `mail` | `email` | `lowercase` | Primary email address |
| `mobile`, `telephone`, `tel` | `phone` | `phone_e164` | Primary contact number |
| `organization`, `business` | `company` | `trim` | Company / Account name |
| `comments`, `inquiry`, `notes` | `message` | `trim` | Message or enquiry text |
| `form_name`, `form_code` | `formId` | `none` | Form identifier |
| `campaign_source`, `ref` | `source` | `none` | Overrides default source |
| `selected_product` | `product` | `none` | Saved to `metadata.customFields.product` |
| `budget_range` | `budget` | `none` | Saved to `metadata.customFields.budget` |

---

## 3. Supported Data Transforms

- `none` — Preserves raw input string.
- `trim` — Strips leading and trailing whitespace.
- `lowercase` — Normalizes characters to lowercase (ideal for email addresses).
- `uppercase` — Normalizes characters to uppercase (ideal for postal codes or license IDs).
- `phone_e164` — Strips formatting brackets, dashes, and spaces, leaving standard digits with country prefix.

---

## 4. Configuring Field Mappings via API

```json
PUT /api/integrations/:id
{
  "fieldMapping": [
    {
      "sourceField": "client_full_name",
      "targetField": "name",
      "transform": "trim",
      "defaultValue": "Website Visitor"
    },
    {
      "sourceField": "client_email",
      "targetField": "email",
      "transform": "lowercase"
    },
    {
      "sourceField": "cellphone",
      "targetField": "phone",
      "transform": "phone_e164"
    },
    {
      "sourceField": "service_interest",
      "targetField": "service",
      "transform": "none",
      "defaultValue": "General Consultation"
    }
  ]
}
```

