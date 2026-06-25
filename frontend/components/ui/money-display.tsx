import * as React from "react"
import { cn } from "@/lib/utils"

interface MoneyDisplayProps {
  paisa: number | bigint
  currency?: string
  className?: string
}

function MoneyDisplay({
  paisa,
  currency = "PKR",
  className,
}: MoneyDisplayProps) {
  const paisaBig = BigInt(paisa)
  const hundred = BigInt(100)
  const rupeesWhole = paisaBig / hundred
  const paisaRemainder = paisaBig % hundred

  const formatted = new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(rupeesWhole) + Number(paisaRemainder) / 100)

  return (
    <span className={cn("tabular-nums font-medium", className)}>
      {formatted}
    </span>
  )
}

export { MoneyDisplay }
