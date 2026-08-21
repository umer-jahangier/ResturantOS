"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Command } from "cmdk";
import { Input } from "@/components/ui/input";
import { useAccountSearch } from "@/lib/hooks/finance/use-accounts";
import type { Account } from "@/lib/models/finance.model";

interface AccountCodeSelectProps {
  value: string;
  selectedName?: string;
  onChange: (account: Account) => void;
  required?: boolean;
}

function AccountCodeSelect({ value, selectedName, onChange, required }: AccountCodeSelectProps) {
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  // The box shows what the user has typed, but must snap back to `value` whenever the
  // parent changes the committed account code from the outside. Rather than mirroring
  // the prop into state from an effect (a cascading extra render, and a frame where the
  // box shows the stale code), track the last prop we reconciled against and adjust
  // during render — React's documented way to reset state when a prop changes. A `key`
  // reset is not usable here: the parent renders these in a list, and remounting the
  // input would drop focus mid-edit.
  const [query, setQuery] = useState(value);
  const [reconciledValue, setReconciledValue] = useState(value);
  const [open, setOpen] = useState(false);
  if (value !== reconciledValue) {
    setReconciledValue(value);
    setQuery(value);
  }
  const { data: results, isFetching } = useAccountSearch(query);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(account: Account) {
    onChange(account);
    setQuery(account.code);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search account code or name"
        required={required}
        className="font-mono"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
      />
      {selectedName && value && (
        <p className="mt-1 truncate text-label text-muted-foreground">{selectedName}</p>
      )}
      {open && query.length > 0 && (
        <div
          id={listId}
          className="absolute z-20 mt-1 max-h-56 w-full overflow-hidden rounded-md border bg-popover shadow-md"
        >
          <Command shouldFilter={false}>
            <Command.List className="max-h-56 overflow-y-auto p-1">
              {isFetching && (
                <div className="px-2 py-2 text-label text-muted-foreground">Searching…</div>
              )}
              {!isFetching && results?.length === 0 && (
                <div className="px-2 py-2 text-label text-muted-foreground">No matching accounts</div>
              )}
              {results?.map((account) => (
                <Command.Item
                  key={account.id}
                  value={account.code}
                  onSelect={() => handleSelect(account)}
                  className="cursor-pointer rounded-sm px-2 py-2 text-small data-[selected=true]:bg-accent"
                >
                  <span className="font-mono tabular-nums">{account.code}</span>
                  <span className="ml-2 text-muted-foreground">{account.name}</span>
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </div>
      )}
    </div>
  );
}

export { AccountCodeSelect };
