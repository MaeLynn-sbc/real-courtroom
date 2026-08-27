import { SemaphoreSmsService } from "@/services/sms/semaphore-sms.service";
import { settingsService } from "@/services/settings/settings.service";

// Mocked, not a real integration test — this hits a real, PAID third-party
// API (Semaphore). Unlike every other service in this app (tested against
// a real dev database), there's no safe way to "prove against real rows"
// here without spending real SMS credits on every test run. fetch and
// settingsService are both mocked; everything else (URL, body
// construction, failure detection) is real code under test.
jest.mock("@/services/settings/settings.service", () => ({
  settingsService: { getBookingCommunicationSettings: jest.fn() },
}));

const mockGetSettings = settingsService.getBookingCommunicationSettings as jest.Mock;

function mockFetchOnce(status: number, body: unknown): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as typeof fetch;
}

describe("SemaphoreSmsService", () => {
  beforeEach(() => {
    mockGetSettings.mockResolvedValue({
      smsSenderName: "",
      smsConfirmationTemplate: "",
      pageConfirmationCopy: "",
    });
  });

  it("posts form-encoded to the Semaphore v4 endpoint with apikey/number/message", async () => {
    mockFetchOnce(200, [{ message_id: 1, status: "Queued", recipient: "09171234567" }]);
    const service = new SemaphoreSmsService();

    await service.send("09171234567", "Hello from The Courtroom");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://api.semaphore.co/api/v4/messages");
    expect(options.method).toBe("POST");
    const body = options.body as URLSearchParams;
    expect(body.get("number")).toBe("09171234567");
    expect(body.get("message")).toBe("Hello from The Courtroom");
    expect(body.has("sendername")).toBe(false);
  });

  it("includes sendername when the CMS setting is non-empty", async () => {
    mockGetSettings.mockResolvedValue({
      smsSenderName: "COURTROOM",
      smsConfirmationTemplate: "",
      pageConfirmationCopy: "",
    });
    mockFetchOnce(200, [{ message_id: 1, status: "Queued", recipient: "09171234567" }]);
    const service = new SemaphoreSmsService();

    await service.send("09171234567", "Hi");

    const options = (global.fetch as jest.Mock).mock.calls[0][1];
    expect((options.body as URLSearchParams).get("sendername")).toBe("COURTROOM");
  });

  it("throws when Semaphore reports the message Failed, not a silent success", async () => {
    mockFetchOnce(200, [{ message_id: 1, status: "Failed", recipient: "09171234567" }]);
    const service = new SemaphoreSmsService();

    await expect(service.send("09171234567", "Hi")).rejects.toThrow(/Failed/);
  });

  it("throws when Semaphore reports the message Refunded", async () => {
    mockFetchOnce(200, [{ message_id: 1, status: "Refunded", recipient: "09171234567" }]);
    const service = new SemaphoreSmsService();

    await expect(service.send("09171234567", "Hi")).rejects.toThrow(/Refunded/);
  });

  it("throws on a non-2xx HTTP response instead of treating it as sent", async () => {
    mockFetchOnce(401, { message: "Unauthorized" });
    const service = new SemaphoreSmsService();

    await expect(service.send("09171234567", "Hi")).rejects.toThrow(/401/);
  });

  it("does not throw for a Queued/Sent/Pending status", async () => {
    mockFetchOnce(200, [{ message_id: 1, status: "Sent", recipient: "09171234567" }]);
    const service = new SemaphoreSmsService();

    await expect(service.send("09171234567", "Hi")).resolves.toEqual({
      providerMessageId: "1",
      providerStatus: "Sent",
    });
  });

  // The id is what makes an SmsLog row reconcilable against the Semaphore
  // dashboard, so it is asserted as a STRING — message_id arrives as a
  // JSON number and must not reach the database as one.
  it("returns the provider message id as a string", async () => {
    mockFetchOnce(200, [{ message_id: 987654321, status: "Queued", recipient: "09171234567" }]);
    const service = new SemaphoreSmsService();

    const result = await service.send("09171234567", "Hi");
    expect(result.providerMessageId).toBe("987654321");
    expect(result.providerStatus).toBe("Queued");
  });

  it("survives a response with no recipients rather than throwing", async () => {
    mockFetchOnce(200, []);
    const service = new SemaphoreSmsService();

    await expect(service.send("09171234567", "Hi")).resolves.toEqual({
      providerMessageId: null,
      providerStatus: null,
    });
  });
});
