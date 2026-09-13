import { render, screen } from "@testing-library/react";
import { useState } from "react";

import { CoachWindowPicker, type CoachWindowChoice } from "./coach-window-picker";

const at = (h: number) => new Date(2031, 3, 7, h, 0);

function Harness({
  freeWindows,
  bookingEndHour,
  initial,
  onValue,
}: {
  freeWindows: { startAt: Date; endAt: Date }[] | null;
  bookingEndHour: number;
  initial?: CoachWindowChoice;
  onValue: (value: CoachWindowChoice) => void;
}) {
  const [value, setValue] = useState<CoachWindowChoice>(initial ?? { hours: 1, startOffsetHours: 0 });
  onValue(value);
  return (
    <CoachWindowPicker
      idPrefix="t"
      bookingStartAt={at(17)}
      bookingEndAt={at(bookingEndHour)}
      freeWindows={freeWindows}
      value={value}
      onChange={setValue}
    />
  );
}

describe("CoachWindowPicker", () => {
  it("a 1-hour booking shows only the hours picker, defaulting to 1 hour", () => {
    let latest: CoachWindowChoice | null = null;
    render(<Harness freeWindows={[{ startAt: at(17), endAt: at(18) }]} bookingEndHour={18} onValue={(v) => (latest = v)} />);
    expect(screen.getByLabelText("Coaching hours")).toHaveTextContent("1 hour");
    expect(screen.queryByText("Coaching starts")).not.toBeInTheDocument();
    expect(latest).toEqual({ hours: 1, startOffsetHours: 0 });
  });

  it("a 2-hour booking with a fully free coach still defaults to 1 hour and offers a start choice", () => {
    let latest: CoachWindowChoice | null = null;
    render(<Harness freeWindows={[{ startAt: at(16), endAt: at(20) }]} bookingEndHour={19} onValue={(v) => (latest = v)} />);
    expect(screen.getByLabelText("Coaching hours")).toHaveTextContent("1 hour");
    // Two legal starts, so the start is a real dropdown showing the first.
    expect(screen.getByLabelText("Coaching starts")).toHaveTextContent("5:00 PM – 6:00 PM");
    expect(latest).toEqual({ hours: 1, startOffsetHours: 0 });
  });

  it("a coach free only for the second hour is placed there, and says so", () => {
    // The coach's complaint (2026-09-13): the coaching must sit on the
    // hour the coach can actually give, and the customer must see it.
    let latest: CoachWindowChoice | null = null;
    render(<Harness freeWindows={[{ startAt: at(18), endAt: at(19) }]} bookingEndHour={19} onValue={(v) => (latest = v)} />);
    expect(screen.getByText(/6:00 PM – 7:00 PM/)).toBeInTheDocument();
    expect(screen.getByText(/the only time this coach is free/)).toBeInTheDocument();
    expect(latest).toEqual({ hours: 1, startOffsetHours: 1 });
  });

  it("snaps a choice the coach cannot honour back to a legal window", () => {
    // Asked for 2 hours from the start, but the coach is only free for
    // the second hour: 1 hour at 6 PM is what can actually be booked.
    let latest: CoachWindowChoice | null = null;
    render(
      <Harness
        freeWindows={[{ startAt: at(18), endAt: at(19) }]}
        bookingEndHour={19}
        initial={{ hours: 2, startOffsetHours: 0 }}
        onValue={(v) => (latest = v)}
      />,
    );
    expect(latest).toEqual({ hours: 1, startOffsetHours: 1 });
  });

  it("with no free windows (staff override) every whole hour of the booking is offered", () => {
    let latest: CoachWindowChoice | null = null;
    render(<Harness freeWindows={null} bookingEndHour={20} initial={{ hours: 2, startOffsetHours: 1 }} onValue={(v) => (latest = v)} />);
    expect(screen.getByLabelText("Coaching hours")).toHaveTextContent("2 hours");
    expect(screen.getByLabelText("Coaching starts")).toHaveTextContent("6:00 PM – 8:00 PM");
    expect(latest).toEqual({ hours: 2, startOffsetHours: 1 });
  });

  it("renders nothing when the coach has no whole free hour", () => {
    const { container } = render(<Harness freeWindows={[]} bookingEndHour={19} onValue={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
