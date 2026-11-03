import { z } from 'zod';

export const ZoneEntrySchema = z.object({
  path: z.string().min(1),
  reason: z.string().min(1),
});
export type ZoneEntry = z.infer<typeof ZoneEntrySchema>;

export const ZonesFileSchema = z.object({
  version: z.literal(1),
  critical: z.array(ZoneEntrySchema).default([]),
  shared: z.array(ZoneEntrySchema).default([]),
});
export type ZonesFile = z.infer<typeof ZonesFileSchema>;

export const ContractSchema = z.object({
  task: z.string().min(1),
  in_scope: z.array(z.string().min(1)).min(1),
  must_change: z.array(z.string().min(1)).default([]),
  must_not_change: z.array(z.string().min(1)).default([]),
});
export type Contract = z.infer<typeof ContractSchema>;

export const ActiveContractSchema = z.object({
  slug: z.string().min(1),
});
export type ActiveContract = z.infer<typeof ActiveContractSchema>;

export const SparkTagSchema = z.object({
  handles: z.array(z.enum(['money', 'personal_data', 'permissions', 'infra', 'none'])),
  confidence: z.enum(['low', 'medium', 'high']),
  reason: z.string().min(1),
});
export type SparkTag = z.infer<typeof SparkTagSchema>;

export const GapQuestionsSchema = z.object({
  questions: z.array(z.string()),
});
export type GapQuestions = z.infer<typeof GapQuestionsSchema>;

export const CheckViolationSchema = z.object({
  rule: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().positive(),
  explanation: z.string().min(1),
});
export type CheckViolation = z.infer<typeof CheckViolationSchema>;

export const CheckResultSchema = z.object({
  verdict: z.enum(['pass', 'fail']),
  violations: z.array(CheckViolationSchema),
  out_of_scope: z.array(z.string()),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const WatchEventSchema = z.object({
  type: z.enum(['drive_by', 'in_scope_change', 'shared_change', 'open_change']),
  file: z.string().min(1),
  tier: z.enum(['critical', 'shared', 'open']),
  reason: z.string().optional(),
  importers: z.array(z.string()).optional(),
  contractSlug: z.string().optional(),
  at: z.string().min(1),
});
export type WatchEvent = z.infer<typeof WatchEventSchema>;
