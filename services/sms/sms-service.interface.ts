// Open-play online self-registration, Gate 1 (BUILD-SPEC.md §6): a
// waitlisted customer isn't watching the dashboard the way staff are —
// SMS is the channel that actually reaches them for a "your slot is
// ready, pay now" invite. Same *-service.interface.ts + console-*
// + *-service.factory.ts shape as services/email/ (this app's existing
// precedent for exactly this kind of swappable-provider concern) — a
// small interface, one method, no provider-specific detail leaking into
// callers.
export interface SmsService {
  send(phone: string, message: string): Promise<void>;
}
