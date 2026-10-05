export type Address = { name: string; address: string };
export type Attachment = { filename: string; mimeType: string; size: number };
export type EmailData = {
  key: string;
  messageId: string | null;
  inReplyTo: string[];
  references: string[];
  date: string;
  from: Address;
  to: Address[];
  cc: Address[];
  replyTo: Address[];
  subject: string;
  normalizedSubject: string;
  bodyText: string;
  newContent: string;
  preview: string;
  attachments: Attachment[];
  zohoStatus: string | null;
};
export type Kind =
  "REQUEST" | "RESPONSE" | "STAFF_SENT" | "FOLLOWUP" | "REVIEW";
export type Decision = {
  kind: Exclude<Kind, "REVIEW">;
  targetKey?: string;
  requestStatus?: "UNANSWERED";
  excludedResponseKeys?: string[];
};
export type MatchMail = Pick<
  EmailData,
  | "key"
  | "messageId"
  | "inReplyTo"
  | "references"
  | "date"
  | "from"
  | "to"
  | "cc"
  | "subject"
  | "normalizedSubject"
> & {
  staffName: string | null;
  addressed: boolean;
  decision: Decision | null;
  approvedKind?: Kind;
  approvedRootKey?: string | null;
};
export type Match = {
  kind: Kind;
  rootKey: string | null;
  reason: string;
  candidates: string[];
  dependencies?: string[];
};
export type ImportStatus =
  | "PROCESSING"
  | "PARTIAL"
  | "READY_FOR_REVIEW"
  | "PARTIALLY_APPROVED"
  | "APPROVED"
  | "DISCARDED"
  | "ERROR"
  | "REVERTED";
