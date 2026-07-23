export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
}

export interface EmailService {
  send(input: SendEmailInput): Promise<void>;
}
