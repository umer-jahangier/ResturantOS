"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { currentPakistanFiscalYear } from "@/lib/utils/pakistan-fiscal-year";

interface FiscalYearNavProps {
  fiscalYear: number;
  onChange: (fiscalYear: number) => void;
}

// Fiscal-year navigator mirroring OpenPeriodDatePicker's chevron-nav pattern,
// but at fiscal-year granularity. Deliberately UNCAPPED (no min/max clamp) —
// FIN-10 requires any past, current, or future fiscal year to be reachable.
function FiscalYearNav({ fiscalYear, onChange }: FiscalYearNavProps) {
  const isCurrent = fiscalYear === currentPakistanFiscalYear();

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Previous fiscal year"
        onClick={() => onChange(fiscalYear - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-sm font-medium">
        FY {fiscalYear - 1}–{fiscalYear} (Jul – Jun)
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Next fiscal year"
        onClick={() => onChange(fiscalYear + 1)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      {!isCurrent && (
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => onChange(currentPakistanFiscalYear())}
        >
          Today
        </Button>
      )}
    </div>
  );
}

export { FiscalYearNav };
