/**
 * Canonical FEATURE_* codes. MUST mirror the backend:
 *  - services/platform-admin-service/.../TierFeatureDefaults.java  (what a tenant can be granted)
 *  - gateway/.../RouteFeatureMap.java                              (what a route demands)
 * Drift here = a nav item that never renders (see UAT 2026-07-13: the phantom
 * "FEATURE_" + "PURCHASING" flag that gated the Purchasing nav item on a flag
 * the backend never granted).
 * Guarded by frontend/__tests__/lib/nav-feature-flags.test.ts.
 */
export const FEATURE_FLAGS = [
  "FEATURE_ANALYTICS",
  "FEATURE_AUDIT_EXPORT",
  "FEATURE_CONSOLIDATED_REPORTING",
  "FEATURE_CRM",
  "FEATURE_CUSTOM_ROLES",
  "FEATURE_ECOMMERCE",
  "FEATURE_FINANCE",
  "FEATURE_HR",
  "FEATURE_INVENTORY",
  "FEATURE_KDS",
  "FEATURE_LOT_TRACKING",
  "FEATURE_LOYALTY",
  "FEATURE_MULTI_BRANCH",
  "FEATURE_NLQ",
  "FEATURE_PAYROLL",
  "FEATURE_POS",
  "FEATURE_REPORTING_ADVANCED",
  "FEATURE_VENDOR",
  "FEATURE_WHATSAPP_NOTIFICATIONS",
  "FEATURE_WHITE_LABEL_DOMAIN",
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
