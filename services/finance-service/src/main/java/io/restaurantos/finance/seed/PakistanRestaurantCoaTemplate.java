package io.restaurantos.finance.seed;

import io.restaurantos.finance.domain.enums.AccountType;
import io.restaurantos.finance.domain.model.ChartOfAccount;

import java.util.List;
import java.util.UUID;

/**
 * 55-account Chart of Accounts template for a Pakistan restaurant operation.
 * System-tagged accounts are used by automated posting in later phases.
 * tenantId is injected at seeding time — never hardcoded here.
 */
public final class PakistanRestaurantCoaTemplate {

    private PakistanRestaurantCoaTemplate() {}

    public static List<ChartOfAccount> build(UUID tenantId) {
        return List.of(
            // ── ASSETS (1000-1900) ──────────────────────────────────────────
            account(tenantId, "1000", "Assets",               AccountType.ASSET,    null,   false, null),
            account(tenantId, "1010", "Cash in Hand",         AccountType.ASSET,    "1000", true,  "CASH"),
            account(tenantId, "1020", "Petty Cash",           AccountType.ASSET,    "1000", true,  "PETTY_CASH"),
            account(tenantId, "1100", "Bank Accounts",        AccountType.ASSET,    "1000", false, null),
            account(tenantId, "1110", "Bank - Main Account",  AccountType.ASSET,    "1100", true,  "BANK"),
            account(tenantId, "1120", "Bank - Payroll Account", AccountType.ASSET,  "1100", false, null),
            account(tenantId, "1200", "Accounts Receivable",  AccountType.ASSET,    "1000", true,  "AR"),
            account(tenantId, "1210", "Receivable - Dine-In", AccountType.ASSET,    "1200", false, null),
            account(tenantId, "1220", "Receivable - Delivery",AccountType.ASSET,    "1200", false, null),
            account(tenantId, "1300", "Inventory",            AccountType.ASSET,    "1000", true,  "INVENTORY"),
            account(tenantId, "1310", "Raw Materials",        AccountType.ASSET,    "1300", true,  "INVENTORY"),
            account(tenantId, "1320", "Goods in Transit",     AccountType.ASSET,    "1300", true,  "INVENTORY_TRANSIT"),
            account(tenantId, "1330", "Packaging Materials",  AccountType.ASSET,    "1300", false, null),
            account(tenantId, "1400", "Prepaid Expenses",     AccountType.ASSET,    "1000", false, null),
            account(tenantId, "1410", "Prepaid Rent",         AccountType.ASSET,    "1400", false, null),
            account(tenantId, "1420", "Prepaid Insurance",    AccountType.ASSET,    "1400", false, null),
            account(tenantId, "1500", "Fixed Assets",         AccountType.ASSET,    "1000", false, null),
            account(tenantId, "1510", "Kitchen Equipment",    AccountType.ASSET,    "1500", false, null),
            account(tenantId, "1520", "Furniture & Fixtures", AccountType.ASSET,    "1500", false, null),
            account(tenantId, "1530", "Leasehold Improvements", AccountType.ASSET,  "1500", false, null),
            account(tenantId, "1600", "Accumulated Depreciation", AccountType.ASSET,"1000", false, null),
            account(tenantId, "1700", "GR/IR Clearing",       AccountType.ASSET,    "1000", true,  "GR_IR"),
            account(tenantId, "1710", "Input Tax (Sales Tax Receivable)", AccountType.ASSET, "1000", true, "INPUT_TAX"),
            account(tenantId, "1800", "Other Current Assets", AccountType.ASSET,    "1000", false, null),
            account(tenantId, "1900", "Security Deposits",    AccountType.ASSET,    "1000", false, null),

            // ── LIABILITIES (2000-2600) ─────────────────────────────────────
            account(tenantId, "2000", "Liabilities",          AccountType.LIABILITY, null,  false, null),
            account(tenantId, "2100", "Accounts Payable",     AccountType.LIABILITY, "2000", true, "AP"),
            account(tenantId, "2110", "Payable - Food Suppliers", AccountType.LIABILITY, "2100", false, null),
            account(tenantId, "2120", "Payable - Utilities",  AccountType.LIABILITY, "2100", false, null),
            account(tenantId, "2200", "Output Tax (Sales Tax Payable)", AccountType.LIABILITY, "2000", true, "OUTPUT_TAX"),
            account(tenantId, "2300", "Wages Payable",        AccountType.LIABILITY, "2000", true,  "WAGES_PAYABLE"),
            account(tenantId, "2400", "Accrued Liabilities",  AccountType.LIABILITY, "2000", false, null),
            account(tenantId, "2500", "Loans Payable",        AccountType.LIABILITY, "2000", false, null),
            account(tenantId, "2600", "Customer Advances",    AccountType.LIABILITY, "2000", false, null),

            // ── EQUITY (3000-3900) ──────────────────────────────────────────
            account(tenantId, "3000", "Equity",               AccountType.EQUITY,   null,   false, null),
            account(tenantId, "3100", "Owner's Capital",      AccountType.EQUITY,   "3000", false, null),
            account(tenantId, "3200", "Retained Earnings",    AccountType.EQUITY,   "3000", false, null),
            account(tenantId, "3900", "Current Year Earnings",AccountType.EQUITY,   "3000", false, null),

            // ── REVENUE (4000-4920) ─────────────────────────────────────────
            account(tenantId, "4000", "Revenue",              AccountType.REVENUE,  null,   false, null),
            account(tenantId, "4100", "Food Sales",           AccountType.REVENUE,  "4000", true,  "REVENUE"),
            account(tenantId, "4200", "Beverage Sales",       AccountType.REVENUE,  "4000", false, null),
            account(tenantId, "4300", "Delivery Sales",       AccountType.REVENUE,  "4000", false, null),
            account(tenantId, "4400", "Catering Revenue",     AccountType.REVENUE,  "4000", false, null),
            account(tenantId, "4900", "Other Revenue",        AccountType.REVENUE,  "4000", false, null),
            account(tenantId, "4910", "Service Charges",      AccountType.REVENUE,  "4900", false, null),
            account(tenantId, "4920", "Discounts Given",      AccountType.REVENUE,  "4900", false, null),

            // ── COGS (5000-5221) ────────────────────────────────────────────
            account(tenantId, "5000", "Cost of Goods Sold",   AccountType.COGS,     null,   false, null),
            account(tenantId, "5100", "Food Cost",            AccountType.COGS,     "5000", true,  "COGS"),
            account(tenantId, "5200", "Beverage Cost",        AccountType.COGS,     "5000", false, null),
            account(tenantId, "5210", "Packaging Cost",       AccountType.COGS,     "5000", false, null),
            account(tenantId, "5220", "Waste & Spoilage",     AccountType.COGS,     "5000", false, null),
            account(tenantId, "5221", "Delivery Cost",        AccountType.COGS,     "5000", false, null),

            // ── EXPENSES (6000-6800) ────────────────────────────────────────
            account(tenantId, "6000", "Operating Expenses",   AccountType.EXPENSE,  null,   false, null),
            account(tenantId, "6100", "Rent Expense",         AccountType.EXPENSE,  "6000", false, null),
            account(tenantId, "6200", "Salaries & Wages",     AccountType.EXPENSE,  "6000", true,  "SALARY_EXPENSE"),
            account(tenantId, "6300", "Utilities Expense",    AccountType.EXPENSE,  "6000", false, null),
            account(tenantId, "6400", "Marketing Expense",    AccountType.EXPENSE,  "6000", false, null),
            account(tenantId, "6500", "Depreciation Expense", AccountType.EXPENSE,  "6000", false, null),
            account(tenantId, "6600", "Repair & Maintenance", AccountType.EXPENSE,  "6000", false, null),
            account(tenantId, "6700", "Insurance Expense",    AccountType.EXPENSE,  "6000", false, null),
            account(tenantId, "6800", "Miscellaneous Expense",AccountType.EXPENSE,  "6000", false, null),

            // ── NON-OPERATING (7000-7200) ───────────────────────────────────
            account(tenantId, "7000", "Non-Operating",        AccountType.EXPENSE,  null,   false, null),
            account(tenantId, "7100", "Finance Charges",      AccountType.EXPENSE,  "7000", false, null),
            account(tenantId, "7200", "Penalty & Fines",      AccountType.EXPENSE,  "7000", false, null)
        );
    }

    private static ChartOfAccount account(UUID tenantId, String code, String name,
                                           AccountType type, String parentCode,
                                           boolean system, String systemTag) {
        ChartOfAccount coa = new ChartOfAccount();
        coa.setTenantId(tenantId);
        coa.setCode(code);
        coa.setName(name);
        coa.setAccountType(type);
        coa.setParentCode(parentCode);
        coa.setSystem(system);
        coa.setSystemTag(systemTag);
        coa.setActive(true);
        return coa;
    }
}
