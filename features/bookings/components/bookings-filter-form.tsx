"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Option {
  value: string;
  label: string;
}

interface BookingsFilterFormProps {
  tab: string;
  dateValue: string;
  statusValue: string;
  sourceValue: string;
  sortValue: string;
  statusOptions: Option[];
  sourceOptions: Option[];
  sortOptions: Option[];
}

const ALL_VALUE = "__all__";

// Native <select> popups are drawn by the OS, not this app's CSS — a
// closed control needs light text against this dashboard's dark
// background, but the OPEN option list gets forced to a white
// background by some browsers (confirmed live: color-scheme: dark
// alone didn't fix it, still washed-out light-on-white on the reporter's
// machine) with no reliable cross-browser way to give the popup itself
// dark styling. Radix's Select sidesteps the problem entirely by
// rendering its own popup from this app's own CSS, never a native OS
// control — same component CoachSessionPanel/TabsPanel/
// SettlementPaymentFields already use without ever hitting this bug.
// Kept as a GET-shaped filter (same query params as before, still
// shareable/bookmarkable) — this component only owns the interactive
// bits; date stays a plain native date input, unaffected by this bug.
export function BookingsFilterForm({
  tab,
  dateValue,
  statusValue,
  sourceValue,
  sortValue,
  statusOptions,
  sourceOptions,
  sortOptions,
}: BookingsFilterFormProps) {
  const router = useRouter();
  const [date, setDate] = useState(dateValue);
  const [status, setStatus] = useState(statusValue || ALL_VALUE);
  const [source, setSource] = useState(sourceValue || ALL_VALUE);
  const [sort, setSort] = useState(sortValue);

  function handleFilter() {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (date) params.set("date", date);
    if (status !== ALL_VALUE) params.set("status", status);
    if (source !== ALL_VALUE) params.set("source", source);
    if (sort) params.set("sort", sort);
    router.push(`/dashboard/bookings?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="date" className="text-sm font-medium">
          Date
        </label>
        <input
          id="date"
          name="date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="status" className="text-sm font-medium">
          Status
        </label>
        <Select value={status} onValueChange={(value) => value && setStatus(value)}>
          <SelectTrigger id="status" className="h-8 w-40">
            <SelectValue>
              {() =>
                status === ALL_VALUE ? "All" : statusOptions.find((o) => o.value === status)?.label
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All</SelectItem>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="source" className="text-sm font-medium">
          Source
        </label>
        <Select value={source} onValueChange={(value) => value && setSource(value)}>
          <SelectTrigger id="source" className="h-8 w-32">
            <SelectValue>
              {() =>
                source === ALL_VALUE ? "All" : sourceOptions.find((o) => o.value === source)?.label
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All</SelectItem>
            {sourceOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="sort" className="text-sm font-medium">
          Sort by
        </label>
        <Select value={sort} onValueChange={(value) => value && setSort(value)}>
          <SelectTrigger id="sort" className="h-8 w-44">
            <SelectValue>
              {() => sortOptions.find((o) => o.value === sort)?.label ?? sort}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <button
        type="button"
        onClick={handleFilter}
        className="border-input hover:bg-muted h-8 rounded-lg border px-3 text-sm font-medium"
      >
        Filter
      </button>
    </div>
  );
}
