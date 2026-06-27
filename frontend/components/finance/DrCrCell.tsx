import { MoneyDisplay } from "@/components/ui/money-display";

interface DrCrCellProps {
  paisa: number;
  type: "debit" | "credit";
}

function DrCrCell({ paisa, type }: DrCrCellProps) {
  if (paisa === 0) {
    return (
      <td className="w-32 text-right font-mono tabular-nums text-muted-foreground">
        —
      </td>
    );
  }
  return (
    <td
      className={`w-32 text-right font-mono tabular-nums ${type === "debit" ? "text-foreground" : "text-foreground"}`}
    >
      <MoneyDisplay paisa={paisa} />
    </td>
  );
}

export { DrCrCell };
