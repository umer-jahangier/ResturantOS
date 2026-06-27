"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useMyBranches } from "@/lib/hooks/auth/use-my-branches";
import { useSwitchBranch } from "@/lib/hooks/auth/use-switch-branch";
import { BranchSwitchOverlay } from "./branch-switch-overlay";

function BranchSwitcherSkeleton() {
  return (
    <div
      className="flex w-full flex-col gap-1"
      aria-busy="true"
      aria-label="Loading branches"
    >
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

// Branch switcher (FE-05, US-1.3). Shown only when the user has >1 assigned branch.
// Selecting a branch reissues the JWT + clears all branch-scoped query cache.
// A denied switch (403 BRANCH_ACCESS_DENIED) keeps current branch + surfaces error.
export function BranchSwitcher() {
  const { branchId } = useCurrentUser();
  const { data: branches = [], isLoading, isError, isFetching, refetch } = useMyBranches();
  const switchBranch = useSwitchBranch();
  const [pendingBranchName, setPendingBranchName] = useState<string | undefined>();

  const isInitialLoad = isLoading || (isFetching && branches.length === 0);

  if (isInitialLoad) {
    return <BranchSwitcherSkeleton />;
  }

  if (isError) {
    return (
      <div className="flex w-full flex-col gap-1.5">
        <p role="alert" className="text-xs text-destructive">
          Could not load branches.
        </p>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (branches.length <= 1) {
    return null;
  }

  const current = branches.find((branch) => branch.id === branchId);
  const denied = switchBranch.isError && switchBranch.error?.isBranchAccessDenied();

  function handleSelect(branch: (typeof branches)[number]) {
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
      <div className="flex w-full flex-col gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={switchBranch.isPending}
              aria-label="Switch branch"
              className="w-full justify-between"
            >
              <span className="truncate">{current?.name ?? "Select branch"}</span>
              {switchBranch.isPending ? (
                <Loader2 className="size-4 shrink-0 animate-spin opacity-60" />
              ) : (
                <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
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
