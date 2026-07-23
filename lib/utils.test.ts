import { cn, formatCurrency } from "@/lib/utils";

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
