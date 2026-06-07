import { z } from "zod";

import type { AdminManagementService } from "../../admin/management-service";
import type { TaskRunnerContext } from "../task-runner-context";

export const blacklistAutomationPayloadSchema = z.object({
	siteKey: z.string().min(1).optional(),
	targetType: z.enum(["ip", "email", "visitor"]),
	matchMode: z.enum(["exact", "cidr", "wildcard"]).default("exact"),
	targetValue: z.string().min(1),
	scope: z.enum(["post", "all"]).default("post"),
	expiresInSec: z.number().int().min(60).max(2_592_000),
	reason: z.string().max(500).optional(),
	sourceMetric: z
		.object({
			metricKey: z.string().min(1),
			windowSec: z.number().int().positive(),
			value: z.number(),
			threshold: z.number(),
		})
		.optional(),
});

export type BlacklistAutomationPayload = z.infer<
	typeof blacklistAutomationPayloadSchema
>;

export interface BlacklistAutomationTaskService {
	createRule(
		input: BlacklistAutomationPayload & {
			runId: string;
			actorUserId?: number;
			now: Date;
		},
	): Promise<unknown>;
}

function redactTarget(
	targetType: BlacklistAutomationPayload["targetType"],
	value: string,
) {
	if (targetType === "ip") {
		const parts = value.split(".");
		return parts.length === 4 ? `${parts[0]}.${parts[1]}.*.*` : "[redacted-ip]";
	}
	if (targetType === "email") {
		const [name, domain] = value.split("@");
		return domain
			? `${name?.slice(0, 2) ?? ""}***@${domain}`
			: "[redacted-email]";
	}
	return "[redacted-visitor]";
}

export class DefaultBlacklistAutomationTaskService
	implements BlacklistAutomationTaskService
{
	public constructor(
		private readonly services: {
			adminManagement: AdminManagementService;
		},
	) {}

	public async createRule(
		input: BlacklistAutomationPayload & {
			runId: string;
			actorUserId?: number;
			now: Date;
		},
	) {
		const expiresAt = new Date(
			input.now.getTime() + input.expiresInSec * 1000,
		).toISOString();
		const rule = await this.services.adminManagement.createBlacklist({
			siteKey: input.siteKey,
			targetType: input.targetType,
			matchMode: input.matchMode,
			targetValue: input.targetValue,
			scope: input.scope,
			reason:
				input.reason ??
				`Task scheduler automation (${input.runId}) temporary blacklist.`,
			expiresAt,
			requestId: `task:${input.runId}`,
			actorUserId: input.actorUserId,
		});
		return {
			rule,
			siteKey: input.siteKey ?? null,
			targetType: input.targetType,
			targetValueRedacted: redactTarget(input.targetType, input.targetValue),
			matchMode: input.matchMode,
			scope: input.scope,
			expiresAt,
			sourceMetric: input.sourceMetric ?? null,
		};
	}
}

export async function runBlacklistAutomationTask(
	payload: BlacklistAutomationPayload,
	context: TaskRunnerContext,
) {
	const service = context.services.blacklistAutomation;
	if (!service) {
		throw new Error("Task service missing: blacklistAutomation");
	}
	await context.writeEvent({
		eventType: "blacklist_automation_precondition_checked",
		message: "blacklist_automation_precondition_checked",
		data: {
			siteKey: payload.siteKey ?? null,
			targetType: payload.targetType,
			targetValueRedacted: redactTarget(
				payload.targetType,
				payload.targetValue,
			),
			sourceMetric: payload.sourceMetric ?? null,
		},
		visibleToSiteAdmin: true,
	});
	return service.createRule({
		...payload,
		runId: context.runId,
		now: context.now(),
		actorUserId:
			context.actor.type === "admin_user" && context.actor.id
				? Number(context.actor.id)
				: undefined,
	});
}
