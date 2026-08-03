"use client";

/**
 * SearchableSelect — reusable combobox built on Popover + Command (cmdk).
 *
 * Use this when the list of options is large enough that a plain <select>
 * would be awkward. It supports:
 *   - Free-text search filtering (case-insensitive, matches any substring)
 *   - Loading state
 *   - Empty state
 *   - Optional "search placeholder" + "select placeholder"
 *   - RTL-friendly (works in both EN and AR layouts)
 *
 * Controlled component — caller owns `value` and `onChange`.
 */
import * as React from "react";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export interface SearchableSelectOption {
  /** Unique value submitted when this option is selected */
  value: string;
  /** Primary label shown in the list and on the trigger when selected */
  label: string;
  /** Optional secondary description shown below the label (muted) */
  description?: string;
  /** Optional search keywords (in addition to label + description) */
  keywords?: string;
}

export interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  /** Placeholder shown when no value is selected */
  placeholder?: string;
  /** Placeholder inside the search box (default: "Search…") */
  searchPlaceholder?: string;
  /** Empty state text when no options match the search */
  emptyText?: string;
  /** Loading state — shows spinner instead of options */
  loading?: boolean;
  /** Disable the trigger button */
  disabled?: boolean;
  /** Extra class on trigger button */
  className?: string;
  /** ID for accessibility / label association */
  id?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results found.",
  loading = false,
  disabled = false,
  className,
  id,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const selected = React.useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  // Reset search when closing
  React.useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled || loading}
          className={cn(
            "w-full justify-between text-xs font-normal h-9",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 me-2 animate-spin" />
              <span className="text-muted-foreground">Loading…</span>
            </>
          ) : selected ? (
            <span className="truncate">{selected.label}</span>
          ) : (
            <span>{placeholder}</span>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0" align="start">
        <Command shouldFilter={true}>
          <div className="flex items-center border-b px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <CommandInput
              placeholder={searchPlaceholder}
              value={search}
              onValueChange={setSearch}
              className="h-9 text-xs border-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <CommandList className="max-h-[260px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : options.length === 0 ? (
              <CommandEmpty>{emptyText}</CommandEmpty>
            ) : (
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={`${opt.label} ${opt.description ?? ""} ${opt.keywords ?? ""}`}
                    onSelect={() => {
                      onChange(opt.value === value ? "" : opt.value);
                      setOpen(false);
                    }}
                    className="text-xs gap-2 py-1.5"
                  >
                    <Check
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        value === opt.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="truncate">{opt.label}</span>
                      {opt.description && (
                        <span className="text-[10px] text-muted-foreground truncate">{opt.description}</span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
