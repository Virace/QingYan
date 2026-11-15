import { z } from "zod";

export const abusePolicySchema = z
	.object({
		syncToWaf: z.boolean().default(false),
		captchaWindowSec: z.number().int().min(10).max(3600).default(60),
		captchaRequestMax: z.number().int().min(5).max(10000).default(30),
		captchaIpMax: z.number().int().min(30).max(100000).default(180),
		commentIpMax: z.number().int().min(6).max(10000).default(30),
		commentBurstMax: z.number().int().min(1).max(100).default(2),
		ipBurstMax: z.number().int().min(6).max(10000).default(12),
		burstWindowSec: z.number().int().min(1).max(300).default(10),
		ipActionMultiplier: z.number().int().min(6).max(100).default(6),
		violationWindowSec: z.number().int().min(10).max(86400).default(60),
		violationThreshold: z.number().int().min(3).max(10000).default(10),
		penaltyTtlSec: z.number().int().min(60).max(31536000).default(86400),
		repeatPenaltyTtlSec: z.number().int().min(60).max(31536000).default(604800),
		repeatWindowSec: z.number().int().min(60).max(31536000).default(2592000),
		evidenceRetentionDays: z.number().int().min(7).max(3650).default(90),
	})
	.strict();
export type AbusePolicy = z.infer<typeof abusePolicySchema>;
export function readAbusePolicy(json?: string | null): AbusePolicy {
	return abusePolicySchema.parse(json ? JSON.parse(json) : {});
}
