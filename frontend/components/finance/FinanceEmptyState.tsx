import { FileText, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

interface FinanceEmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: {
    label: string;
    onClick: () => void;
  };
}

function FinanceEmptyState({
  title,
  description,
  icon = FileText,
  action,
}: FinanceEmptyStateProps) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={description}
      action={action}
    />
  );
}

export { FinanceEmptyState };
