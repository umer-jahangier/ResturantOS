"use client";

import { useState } from "react";
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
import { BranchSwitchOverlay } from "./branch-switch-overlay";

// Branch switcher (FE-05, W3). Only rendered for OWNER role (rbac.manage permission).
// Selecting a branch reissues the JWT + clears all branch-scoped query cache.
// A full-page overlay shows while the switch is in-flight.
// A denied switch (403 BRANCH_ACCESS_DENIED) keeps current branch + surfaces error.
//
// Phase-4 stub: available branches are hardcoded to match the dev seed data.
// Live list will come from GET /api/v1/branches in Phase-3.
export interface BranchOption {
  id: string;
  name: string;
}

// TODO(Phase-3): replace with live GET /api/v1/branches response
const DEFAULT_BRANCHES: BranchOption[] = [
  { id: "b0000001-0000-4000-8000-000000000001", name: "Main Branch (HQ)" },
  { id: "b0000002-0000-4000-8000-000000000002", name: "Downtown Branch" },
];

interface BranchSwitcherProps {
  branches?: BranchOption[];
}

export function BranchSwitcher({ branches = DEFAULT_BRANCHES }: BranchSwitcherProps) {
  const { branchId } = useCurrentUser();
  const switchBranch = useSwitchBranch();
  const [pendingBranchName, setPendingBranchName] = useState<string | undefined>();

  const current = branches.find((branch) => branch.id === branchId);
  const denied = switchBranch.isError && switchBranch.error?.isBranchAccessDenied();

  function handleSelect(branch: BranchOption) {
    if (branch.id !== branchId) {
      setPendingBranchName(branch.name);
      switchBranch.mutate(branch.id, {
        onSettled: () => setPendingBranchName(undefined),
      });
    }
  }

  return (
    <>
      <BranchSwitchOverlay
        isVisible={switchBranch.isPending}
        branchName={pendingBranchName}
      />
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
                  onSelect={() => handleSelect(branch)}
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
    </>
  );
}
