import type { Bilingual } from "@vivaha/shared";

// A refusal the operator reads. It carries both languages, because the panel's
// language is a preference on the client and the server should not have to know
// it to say "only 1,650 left" properly.
export class HttpError extends Error {
  status: number;
  details?: unknown;
  /** The same message in Hindi, when the call site had one. */
  messageHi?: string;
  constructor(status: number, message: string | Bilingual, details?: unknown) {
    const en = typeof message === "string" ? message : message.en;
    super(en);
    this.status = status;
    this.details = details;
    if (typeof message !== "string") this.messageHi = message.hi;
  }
}
export const badRequest = (message: string | Bilingual, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message: string | Bilingual = "Unauthorized") => new HttpError(401, message);
export const forbidden = (message: string | Bilingual = "Forbidden") => new HttpError(403, message);
export const notFound = (message: string | Bilingual = "Not found") => new HttpError(404, message);
export const conflict = (message: string | Bilingual, details?: unknown) => new HttpError(409, message, details);
