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

// Why a send failed, in the only terms that matter for recovery: could
// the message already be in the provider's queue?
//
//   REFUSED     401/403/429 — the provider received the request and
//               explicitly declined it before queuing. PROVABLY NOT SENT.
//   VALIDATION  400/422 — this recipient was rejected. Not sent, but the
//               reason is the entity, not the system.
//   HTTP_ERROR  5xx — the provider broke. Before or after accepting the
//               message is unknowable from here. AMBIGUOUS.
//   TIMEOUT     no response in time. The request may have been fully
//               processed and only the RESPONSE lost. AMBIGUOUS, and the
//               likeliest way to have sent a message you believe failed.
//   NETWORK     the request may never have left. AMBIGUOUS.
//   REJECTED    HTTP 200, provider reports Failed/Refunded — it accepted
//               the request and declined to deliver.
export type SmsFailureKind =
  | "REFUSED"
  | "VALIDATION"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "NETWORK"
  | "REJECTED";

export class SmsSendError extends Error {
  readonly kind: SmsFailureKind;
  readonly httpStatus: number | null;

  constructor(message: string, kind: SmsFailureKind, httpStatus: number | null = null) {
    super(message);
    this.name = "SmsSendError";
    this.kind = kind;
    this.httpStatus = httpStatus;
  }

  // The ONLY condition under which it is safe to release the dedupeKey and
  // allow a future retry. Deliberately excludes VALIDATION (nothing was
  // sent, but the number is the problem — retrying changes nothing) and
  // every ambiguous kind.
  get provablyNotSent(): boolean {
    return this.kind === "REFUSED";
  }
}
