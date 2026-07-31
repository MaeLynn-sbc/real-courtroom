import { render, screen } from "@testing-library/react";

import { DashboardHeader } from "./dashboard-header";

jest.mock("@/components/layout/user-nav", () => ({
  UserNav: () => null,
}));
jest.mock("@/features/notifications/components/notification-bell", () => ({
  NotificationBell: () => null,
}));

// Reported live: the pending-verification indicator was an icon with a
// 20px corner dot (10px text) — easy to miss on a busy desk screen. Now
// a real, wide pill with a large bold count and a plain-language label,
// proven here to actually render the count and label text, not just the
// tiny badge dot the old version relied on.
describe("DashboardHeader — pending verification pill", () => {
  it("shows a large, worded pill for pending booking payment verifications", () => {
    render(<DashboardHeader pendingVerificationCount={1} pendingOpenPlayVerificationCount={0} onDutyShifts={null} />);

    const link = screen.getByRole("link", { name: /1 payment verification pending/i });
    expect(link).toHaveAttribute("href", "/dashboard/bookings/verify-payments");
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("payment to verify")).toBeInTheDocument();
  });

  it("pluralizes the label for more than one pending verification", () => {
    render(<DashboardHeader pendingVerificationCount={3} pendingOpenPlayVerificationCount={2} onDutyShifts={null} />);

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("payments to verify")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("open play payments to verify")).toBeInTheDocument();
  });

  it("shows neither pill when nothing is pending", () => {
    render(<DashboardHeader pendingVerificationCount={0} pendingOpenPlayVerificationCount={0} onDutyShifts={null} />);

    expect(screen.queryByText(/payment to verify|payments to verify/)).not.toBeInTheDocument();
  });
});
