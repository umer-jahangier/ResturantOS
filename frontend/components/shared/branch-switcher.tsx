"use client";

import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useSwitchBranch } from "@/lib/hooks/auth/use-switch-branch";

// Branch switcher (FE-05, W3). Selecting a branch reissues the JWT + clears the
// branch-scoped query cache via useSwitchBranch. A denied switch (403
// BRANCH_ACCESS_DENIED) keeps the current branch highlighted and surfaces the
// error (toast from the hook + inline message) WITHOUT mutating the session.
//
// Phase-4 stub: the available branches are a static source here. The live list
// will come from a Phase-3 contract (e.g. /api/v1/branches) — see SUMMARY.
export interface BranchOption {
  id: string;
  name: string;
}

const DEFAULT_BRANCHES: BranchOption[] = [
  { id: "33333333-3333-4333-8333-333333333333", name: "Main Branch" },
  { id: "44444444-4444-4444-8444-444444444444", name: "Downtown Branch" },
];

interface BranchSwitcherProps {
  branches?: BranchOption[];
}

export function BranchSwitcher({ branches = DEFAULT_BRANCHES }: BranchSwitcherProps) {
  const { branchId } = useCurrentUser();
  const switchBranch = useSwitchBranch();

  const current = branches.find((branch) => branch.id === branchId);
  const denied = switchBranch.isError && switchBranch.error?.isBranchAccessDenied();

  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={switchBranch.isPending}
            aria-label="Switch branch"
          >
            <span className="truncate">{current?.name ?? "Select branch"}</span>
            <ChevronsUpDown className="size-4 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Branches</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {branches.map((branch) => {
            const isActive = branch.id === branchId;
            return (
              <DropdownMenuItem
                key={branch.id}
                data-active={isActive}
                onSelect={() => {
                  if (!isActive) {
                    switchBranch.mutate(branch.id);
                  }
                }}
              >
                <Check className={cn("size-4", isActive ? "opacity-100" : "opacity-0")} />
                <span>{branch.name}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {denied ? (
        <p role="alert" className="text-xs text-destructive">
          You don&apos;t have access to that branch.
        </p>
      ) : null}
    </div>
  );
}
