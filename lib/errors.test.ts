import { toActionError } from "@/lib/errors";

jest.mock("@/lib/logger", () => ({
  logger: { error: jest.fn() },
}));

describe("toActionError", () => {
  it("returns a curated message for a unique constraint violation", () => {
    expect(toActionError({ code: "P2002" }, { action: "test" })).toBe("That value is already in use.");
  });

  it("returns a curated message for a missing record", () => {
    expect(toActionError({ code: "P2025" }, { action: "test" })).toBe("That record no longer exists.");
  });

  // Hardening phase fix: exhausting runSerializableWithRetry's 5 attempts
  // used to fall through to `error.message`, surfacing Prisma's raw P2034
  // text ("Transaction failed due to a write conflict or a deadlock.
  // Please retry your transaction") to the client uncurated — the only
  // Prisma code this function let through raw.
  it("returns a curated message for exhausted serialization retries (P2034)", () => {
    expect(toActionError({ code: "P2034" }, { action: "test" })).toBe(
      "This is taking longer than expected — please try again.",
    );
  });

  it("returns a curated message for the P2010-wrapped serialization failure (SQLSTATE 40001)", () => {
    const error = {
      code: "P2010",
      meta: { driverAdapterError: { cause: { originalCode: "40001" } } },
    };
    expect(toActionError(error, { action: "test" })).toBe("This is taking longer than expected — please try again.");
  });

  it("does not treat an unrelated P2010 (a different raw-query failure) as a serialization failure", () => {
    const error = {
      code: "P2010",
      meta: { driverAdapterError: { cause: { originalCode: "23505" } } },
    };
    expect(toActionError(error, { action: "test" })).toBe("Something went wrong. Please try again.");
  });

  it("falls back to the error's own message for anything else", () => {
    expect(toActionError(new Error("Cannot cancel an assignment with status DONE."), { action: "test" })).toBe(
      "Cannot cancel an assignment with status DONE.",
    );
  });

  it("falls back to a generic message for a non-Error thrown value", () => {
    expect(toActionError("not an error", { action: "test" })).toBe("Something went wrong. Please try again.");
  });
});
