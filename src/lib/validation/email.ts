import { z } from "zod";
const address = z.object({
  name: z.string().max(2000),
  address: z.email().max(320),
});
export const emailSchema = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/),
  messageId: z.string().max(2000).nullable(),
  inReplyTo: z.array(z.string().max(2000)).max(500),
  references: z.array(z.string().max(2000)).max(500),
  date: z.iso.datetime({ offset: true }),
  from: address,
  to: z.array(address).max(500),
  cc: z.array(address).max(500),
  replyTo: z.array(address).max(500),
  subject: z.string().max(10000),
  normalizedSubject: z.string().max(10000),
  bodyText: z.string().max(1000000),
  newContent: z.string().max(1000000),
  preview: z.string().max(260),
  attachments: z
    .array(
      z.object({
        filename: z.string().max(2000),
        mimeType: z.string().max(300),
        size: z.number().int().nonnegative(),
      }),
    )
    .max(1000),
  zohoStatus: z.string().max(2000).nullable(),
});
export const decisionSchema = z.object({
  kind: z.enum(["REQUEST", "RESPONSE", "STAFF_SENT", "FOLLOWUP"]),
  targetKey: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
