import { formatTime12h } from "./format-time";

describe("formatTime12h", () => {
  it("formats a morning hour", () => {
    expect(formatTime12h("07:00")).toBe("7:00 AM");
  });

  it("formats an afternoon hour", () => {
    expect(formatTime12h("15:00")).toBe("3:00 PM");
  });

  it("formats midnight as 12 AM", () => {
    expect(formatTime12h("00:00")).toBe("12:00 AM");
  });

  it("formats noon as 12 PM", () => {
    expect(formatTime12h("12:00")).toBe("12:00 PM");
  });

  it("preserves minutes", () => {
    expect(formatTime12h("23:45")).toBe("11:45 PM");
  });
});
