"use client"

import * as React from "react"
import CountUp from "react-countup"
import { cn } from "@/lib/utils"

interface AnimatedNumberProps {
  value: number
  prefix?: string
  suffix?: string
  decimals?: number
  duration?: number
  className?: string
}

function AnimatedNumber({
  value,
  prefix,
  suffix,
  decimals = 0,
  duration = 1.5,
  className,
}: AnimatedNumberProps) {
  return (
    <span className={cn("tabular-nums", className)}>
      <CountUp
        end={value}
        prefix={prefix}
        suffix={suffix}
        decimals={decimals}
        duration={duration}
        useEasing
        enableScrollSpy
        scrollSpyOnce
      />
    </span>
  )
}

export { AnimatedNumber }
