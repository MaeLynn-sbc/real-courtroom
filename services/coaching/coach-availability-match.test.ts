import { isSlotFullyCovered } from "./coach-availability-match";

const hour = (h: number, m = 0) => new Date(2031, 3, 7, h, m);

describe("isSlotFullyCovered", () => {
  it("qualifies when the window exactly matches the slot", () => {
    expect(isSlotFullyCovered(hour(10), hour(11), hour(10), hour(11))).toBe(true);
  });

  it("qualifies when the window fully contains the slot", () => {
    expect(isSlotFullyCovered(hour(10), hour(11), hour(9), hour(12))).toBe(true);
  });

  it("does not qualify when the window only partially overlaps the start", () => {
    expect(isSlotFullyCovered(hour(10), hour(11), hour(9), hour(10, 30))).toBe(false);
  });

  it("does not qualify when the window only partially overlaps the end", () => {
    expect(isSlotFullyCovered(hour(10), hour(11), hour(10, 30), hour(12))).toBe(false);
  });

  it("does not qualify when the window doesn't overlap at all", () => {
    expect(isSlotFullyCovered(hour(10), hour(11), hour(14), hour(15))).toBe(false);
  });

  it("does not qualify when the window is fully inside the slot (shorter than it)", () => {
    expect(isSlotFullyCovered(hour(9), hour(12), hour(10), hour(11))).toBe(false);
  });
});
