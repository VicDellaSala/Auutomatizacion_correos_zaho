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
export type DecisionValues = {
  kind: Exclude<Kind, "REVIEW">;
  targetKey?: string;
  requestStatus?: "UNANSWERED" | "ANSWERED" | "AFTER_HOURS";
  excludedResponseKeys?: string[];
  ignored?: boolean;
  ignoredReason?: string;
  responsibleId?: string;
  responsibleName?: string;
  manualAnsweredAt?: string;
  manualResponseAdditional?: boolean;
};
export type CorrectionSnapshot = {
  kind: Kind;
  rootKey: string | null;
  staffName: string | null;
  decision: DecisionValues | null;
};
export type AuditEntry = {
  at: string;
  userId: string;
  userName: string;
  before: CorrectionSnapshot;
  after: CorrectionSnapshot;
};
export type Decision = DecisionValues & { audit?: AuditEntry[] };
export type AttentionState =
  | "ANSWERED"
  | "UNANSWERED"
  | "AFTER_HOURS"
  | "IGNORED"
  | "REVIEW"
  | "STAFF_SENT"
  | "RESPONSE"
  | "FOLLOWUP";
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
