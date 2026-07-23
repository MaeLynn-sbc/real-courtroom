export interface ChargeInput {
  amountCents: number;
  currency: string;
  description: string;
  referenceId: string;
}

export interface ChargeResult {
  id: string;
  status: "succeeded" | "failed";
  provider: string;
  amountCents: number;
  currency: string;
}

export interface PaymentService {
  charge(input: ChargeInput): Promise<ChargeResult>;
}
