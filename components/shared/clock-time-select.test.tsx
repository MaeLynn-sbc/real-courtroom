import { fireEvent, render, screen } from "@testing-library/react";

import { ClockTimeSelect } from "./clock-time-select";
import { DateTimeField } from "./date-time-field";

describe("ClockTimeSelect", () => {
  it("defaults the minute to :00 when an hour is picked first", () => {
    const onChange = jest.fn();
    render(<ClockTimeSelect aria-label="Clock in" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Clock in hour"), { target: { value: "08" } });
    expect(onChange).toHaveBeenCalledWith("08:00");
  });

  it("keeps the hour when the minute changes", () => {
    const onChange = jest.fn();
    render(<ClockTimeSelect aria-label="Clock in" value="08:00" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Clock in minute"), { target: { value: "35" } });
    expect(onChange).toHaveBeenCalledWith("08:35");
  });

  it("still shows a saved minute that is off the step", () => {
    render(<ClockTimeSelect aria-label="Clock in" value="08:07" onChange={jest.fn()} />);
    expect(screen.getByLabelText("Clock in minute")).toHaveValue("07");
  });

  it("clears the whole value through the empty choice", () => {
    const onChange = jest.fn();
    render(<ClockTimeSelect aria-label="Start" value="09:15" emptyLabel="—" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Start hour"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("DateTimeField", () => {
  it("produces the same value shape as datetime-local", () => {
    const onChange = jest.fn();
    render(<DateTimeField aria-label="Ends" value="2026-10-05T18:00" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Ends time minute"), { target: { value: "30" } });
    expect(onChange).toHaveBeenCalledWith("2026-10-05T18:30");
  });

  it("keeps a time picked before the date", () => {
    const onChange = jest.fn();
    const { rerender } = render(<DateTimeField aria-label="Ends" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Ends time hour"), { target: { value: "18" } });
    expect(onChange).toHaveBeenLastCalledWith("T18:00");

    rerender(<DateTimeField aria-label="Ends" value="T18:00" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Ends date"), { target: { value: "2026-10-05" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-10-05T18:00");
  });
});
