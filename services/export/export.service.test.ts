import { toCsv } from "@/services/export/export.service";

describe("toCsv", () => {
  it("renders a header row and one row per item", () => {
    const rows = [
      { name: "Court 1", hours: 4 },
      { name: "Court 2", hours: 2.5 },
    ];
    const csv = toCsv(rows, [
      { header: "Court", value: (r) => r.name },
      { header: "Hours", value: (r) => r.hours },
    ]);
    expect(csv).toBe("Court,Hours\r\nCourt 1,4\r\nCourt 2,2.5");
  });

  it("quotes a field containing a comma", () => {
    const csv = toCsv([{ note: "Paddle, blue" }], [{ header: "Note", value: (r) => r.note }]);
    expect(csv).toBe('Note\r\n"Paddle, blue"');
  });

  it("quotes and doubles embedded quotes", () => {
    const csv = toCsv([{ note: 'Said "hello"' }], [{ header: "Note", value: (r) => r.note }]);
    expect(csv).toBe('Note\r\n"Said ""hello"""');
  });

  it("quotes a field containing a newline", () => {
    const csv = toCsv([{ note: "line1\nline2" }], [{ header: "Note", value: (r) => r.note }]);
    expect(csv).toBe('Note\r\n"line1\nline2"');
  });

  it("renders null/undefined as an empty field", () => {
    const csv = toCsv([{ value: null }, { value: undefined }], [
      { header: "Value", value: (r: { value: null | undefined }) => r.value },
    ]);
    expect(csv).toBe("Value\r\n\r\n");
  });

  it("renders Date values as ISO strings", () => {
    const date = new Date(Date.UTC(2026, 6, 20, 12, 0, 0));
    const csv = toCsv([{ date }], [{ header: "Date", value: (r) => r.date }]);
    expect(csv).toBe("Date\r\n2026-07-20T12:00:00.000Z");
  });

  it("returns just the header line for an empty row set", () => {
    const csv = toCsv([], [{ header: "Court", value: () => "" }]);
    expect(csv).toBe("Court");
  });
});
