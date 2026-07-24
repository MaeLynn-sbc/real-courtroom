import { cn, formatCurrency, formatRelativeTime } from "@/lib/utils";

describe("cn", () => {
  it("merges class names and resolves Tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("drops falsy values", () => {
    expect(cn("text-sm", false && "hidden", undefined, "font-medium")).toBe(
      "text-sm font-medium",
    );
  });
});

describe("formatCurrency", () => {
  it("formats integer cents as PHP currency", () => {
    expect(formatCurrency(40000)).toBe("₱400.00");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("₱0.00");
  });
});

describe("formatRelativeTime", () => {
  it("shows 'just now' for under a minute", () => {
    // 10s, not 30s — Math.round(30_000 / 60_000) rounds the 0.5-minute
    // boundary up to 1, which would flakily produce "1m ago" instead.
    expect(formatRelativeTime(new Date(Date.now() - 10_000))).toBe("just now");
  });

  it("shows minutes for under an hour", () => {
    expect(formatRelativeTime(new Date(Date.now() - 5 * 60_000))).toBe("5m ago");
  });

  it("shows hours for under a day", () => {
    expect(formatRelativeTime(new Date(Date.now() - 3 * 3_600_000))).toBe("3h ago");
  });

  it("shows days beyond that", () => {
    expect(formatRelativeTime(new Date(Date.now() - 2 * 86_400_000))).toBe("2d ago");
  });
});
