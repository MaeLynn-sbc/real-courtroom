interface PlayerSearchFiltersProps {
  query?: string;
  skillLevel?: string;
}

const SKILL_LEVEL_OPTIONS = [
  { value: "BEGINNER", label: "Beginner" },
  { value: "INTERMEDIATE", label: "Intermediate" },
  { value: "ADVANCED", label: "Advanced" },
  { value: "PRO", label: "Pro" },
] as const;

export function PlayerSearchFilters({ query, skillLevel }: PlayerSearchFiltersProps) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="query" className="text-sm font-medium">
          Search
        </label>
        <input
          id="query"
          name="query"
          type="text"
          placeholder="Name or email"
          defaultValue={query}
          className="border-input h-8 w-56 rounded-lg border bg-transparent px-2.5 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="skillLevel" className="text-sm font-medium">
          Skill level
        </label>
        <select
          id="skillLevel"
          name="skillLevel"
          defaultValue={skillLevel ?? ""}
          className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
        >
          <option value="">All</option>
          {SKILL_LEVEL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className="border-input hover:bg-muted h-8 rounded-lg border px-3 text-sm font-medium"
      >
        Filter
      </button>
    </form>
  );
}
