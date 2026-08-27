// Open-play online self-registration, Gate 1 (BUILD-SPEC.md §6): a
// waitlisted customer isn't watching the dashboard the way staff are —
// SMS is the channel that actually reaches them for a "your slot is
// ready, pay now" invite. Same *-service.interface.ts + console-*
// + *-service.factory.ts shape as services/email/ (this app's existing
// precedent for exactly this kind of swappable-provider concern) — a
// small interface, one method, no provider-specific detail leaking into
// callers.
// What the provider said about the message it accepted. Both fields are
// null for a provider that has nothing to report (the dev console logger).
// Kept so an SmsLog row can be matched one-to-one against the Semaphore
// dashboard — without the id, "did this actually go out?" is answerable
// only by squinting at timestamps.
export interface SmsSendResult {
  providerMessageId: string | null;
  providerStatus: string | null;
}

export interface SmsService {
  send(phone: string, message: string): Promise<SmsSendResult>;
}
