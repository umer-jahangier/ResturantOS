import type { ServiceHealth } from "@/lib/models/ops.model";

/**
 * What a restaurant calls each service, and what stops working when it stops.
 *
 * <p>`pos-service` is a deployment artefact's name. The person reading this screen has a queue at
 * the counter and needs to know that the till is down and that the kitchen board is not — so every
 * row is labelled in the vocabulary of the business, with the raw service name kept beside it
 * because that is the string they will be asked for on the phone.
 *
 * <p>An unmapped service still renders. It gets its raw name as the label and no consequence
 * sentence, which is honest — inventing a description for a service this file has never heard of
 * would be the more confident and more wrong option. This is why the screen is driven by the
 * gateway's route table and only DECORATED here: a service missing from this map is a missing
 * caption, never a missing row.
 */
interface ServiceCopy {
  label: string;
  /** What the operator loses while it is down. One clause, present tense. */
  consequence: string;
}

const COPY: Record<string, ServiceCopy> = {
  "auth-service": {
    label: "Sign-in",
    consequence: "nobody can sign in or refresh an expired session",
  },
  "authorization-service": {
    label: "Permissions",
    consequence: "actions that need an approval check are refused",
  },
  "user-service": {
    label: "Staff accounts",
    consequence: "you cannot add staff or change what they can do",
  },
  "platform-admin-service": {
    label: "Plan and modules",
    consequence: "module entitlement checks fall back and some screens may be hidden",
  },
  "audit-service": { label: "Audit log", consequence: "the activity trail stops recording" },
  "file-service": {
    label: "Images and files",
    consequence: "menu photos and uploaded documents do not load",
  },
  "finance-service": {
    label: "Accounts and takings",
    consequence: "the ledger, takings and period close are unavailable",
  },
  "pos-service": {
    label: "Till and orders",
    consequence: "no orders, no payments, no table plan and no till session",
  },
  "kitchen-service": {
    label: "Kitchen display",
    consequence: "the kitchen board stops receiving and bumping tickets",
  },
  "inventory-service": {
    label: "Stock",
    consequence: "stock counts, receipts and recipes are unavailable",
  },
  "purchasing-service": {
    label: "Purchasing",
    consequence: "vendors, purchase orders and invoices are unavailable",
  },
  "crm-service": {
    label: "Customers",
    consequence: "customer lookup and loyalty points are unavailable",
  },
  "hr-service": {
    label: "Staff and payroll",
    consequence: "attendance and payroll are unavailable",
  },
  "reporting-service": { label: "Reports", consequence: "reports and dashboards do not load" },
  "nlq-service": { label: "Ask (NLQ)", consequence: "natural-language questions are unavailable" },
};

export function serviceLabel(service: ServiceHealth): string {
  return COPY[service.name]?.label ?? service.name;
}

export function serviceConsequence(service: ServiceHealth): string | null {
  return COPY[service.name]?.consequence ?? null;
}
