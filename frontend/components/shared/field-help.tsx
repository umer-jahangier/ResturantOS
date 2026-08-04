"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";

import { FormLabel } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface FieldHelpProps {
  /** The field's own label — becomes the screen-reader name of the trigger. */
  label: string;
  /** One or two short sentences. Anything longer belongs in documentation, not beside an input. */
  children: React.ReactNode;
}

/**
 * The small "?" beside a field label.
 *
 * <p>Opens on hover AND on click, because those cover different people: a mouse user expects to
 * skim without committing, while touch and keyboard users have no hover at all. A plain tooltip
 * would silently exclude the second group.
 *
 * <p>Focus deliberately stays in the form when it opens — this is a glance, not a destination, and
 * yanking focus out of a field mid-entry to read a hint would cost more than the hint is worth.
 */
export function FieldHelp({ label, children }: FieldHelpProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        asChild
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <button
          type="button"
          // type="button" is load-bearing: an unqualified <button> inside a <form> submits it.
          // data-slot lets a test single out the field's REAL control — a form item that holds a
          // combobox now holds two buttons, and `getByRole("button")` alone is ambiguous.
          data-slot="field-help"
          // Click OPENS rather than toggles. Radix's trigger toggles by default, which fights the
          // hover handler above: moving the pointer onto the button opens it, and the click that
          // follows would immediately close it again — so a mouse user could never click it open,
          // and a touch user (who gets the click without the hover) would see it flicker. Calling
          // preventDefault suppresses Radix's own handler; Escape, an outside click and
          // mouse-leave all still close it.
          onClick={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
          aria-label={`What is "${label}"?`}
          className="text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-full"
        >
          <HelpCircle className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-64 p-3 text-xs leading-relaxed text-muted-foreground"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

interface FieldLabelProps {
  /** The visible label text. Also names the help trigger, so keep it identical to the field's. */
  children: string;
  /** The explanation. Omit for a field whose name genuinely says everything ("Name"). */
  help?: React.ReactNode;
  /** Passed through to the label — line-item labels inside a repeating row use `text-xs`. */
  className?: string;
}

/**
 * A form label with its optional help affordance. Use in place of a bare {@code FormLabel} — it
 * keeps the icon's spacing and the trigger's accessible name in ONE place, so thirty fields cannot
 * drift into thirty slightly different treatments.
 *
 * <p>Must still live inside a {@code FormItem}: {@code FormLabel} reads that context to wire
 * {@code htmlFor} to the control.
 */
export function FieldLabel({ children, help, className }: FieldLabelProps) {
  if (!help) {
    return <FormLabel className={className}>{children}</FormLabel>;
  }
  return (
    <div className="flex items-center gap-1.5">
      <FormLabel className={className}>{children}</FormLabel>
      <FieldHelp label={children}>{help}</FieldHelp>
    </div>
  );
}
