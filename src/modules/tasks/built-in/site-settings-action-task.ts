import { z } from "zod";

import type { AdminManagementService } from "../../admin/management-service";
import type { TaskRunRepository } from "../task-run-repository";
import type { TaskRunnerContext } from "../task-runner-context";

const siteSettingsActionSchema = z.enum([
	"disable_comments",
	"disable_visitors",
	"disable_page_views",
	"disable_page_reactions",
	"disable_metadata_persistence",
	"elevate_captcha",
]);

export const siteSettingsActionPayloadSchema = z.object({
	siteKey: z.string().min(1),
	action: siteSettingsActionSchema,
	ttlSec: z.number().int().min(60).max(86_400),
	restoreSnapshot: z.unknown().optional(),
	restore: z.boolean().optional(),
});

export type SiteSettingsActionPayload = z.infer<
	typeof siteSettingsActionPayloadSchema
>;

export interface SiteSettingsActionTaskService {
	applyAction(
		input: SiteSettingsActionPayload & {
			runId: string;
			actorUserId?: number;
		},
	): Promise<unknown>;
}

function automationRequestId(runId: string) {
	return `task:${runId}`;
}

export class DefaultSiteSettingsActionTaskService
	implements SiteSettingsActionTaskService
{
	public constructor(
		private readonly services: {
			adminManagement: AdminManagementService;
			taskRuns?: TaskRunRepository;
		},
	) {}

	public async applyAction(
		input: SiteSettingsActionPayload & {
			runId: string;
			actorUserId?: number;
		},
	) {
		if (input.restore) {
			if (!input.restoreSnapshot || typeof input.restoreSnapshot !== "object") {
				throw new Error("RESTORE_SNAPSHOT_REQUIRED");
			}
			return this.services.adminManagement.updateSettings(input.siteKey, {
				...(input.restoreSnapshot as Parameters<
					AdminManagementService["updateSettings"]
				>[1]),
				requestId: automationRequestId(input.runId),
				actorUserId: input.actorUserId,
			});
		}

		const before = await this.services.adminManagement.getSettings(
			input.siteKey,
		);
		const patch = buildSettingsPatch(input.action);
		const updated = await this.services.adminManagement.updateSettings(
			input.siteKey,
			{
				...patch,
				requestId: automationRequestId(input.runId),
				actorUserId: input.actorUserId,
			},
		);
		const restorePayload = {
			siteKey: input.siteKey,
			action: input.action,
			ttlSec: input.ttlSec,
			restore: true,
			restoreSnapshot: buildRestoreSnapshot(before),
		};
		const runAfter = new Date(Date.now() + input.ttlSec * 1000).toISOString();
		const restoreRun = this.services.taskRuns
			? await this.services.taskRuns.create({
					type: "site_settings_action",
					category: "system",
					siteKey: input.siteKey,
					subjectType: "site",
					subjectId: input.siteKey,
					runAfter,
					payloadSummary: {
						siteKey: input.siteKey,
						action: input.action,
						restore: true,
					},
					payload: restorePayload,
				})
			: null;
		return {
			action: input.action,
			siteKey: input.siteKey,
			ttlSec: input.ttlSec,
			beforeSnapshot: buildRestoreSnapshot(before),
			updated,
			restore: {
				kind: "task_run_restore",
				runAfter,
				runId: restoreRun?.id ?? null,
				payload: restorePayload,
			},
		};
	}
}

function buildRestoreSnapshot(
	settings: Awaited<ReturnType<AdminManagementService["getSettings"]>>,
): Parameters<AdminManagementService["updateSettings"]>[1] {
	return {
		comments: {
			enabled: settings.comments.enabled,
			captcha: {
				mode: settings.comments.captcha.mode as
					| "never"
					| "always"
					| "threshold",
				thresholdWindowSec: settings.comments.captcha.thresholdWindowSec,
				thresholdMaxActions: settings.comments.captcha.thresholdMaxActions,
			},
			metadata: settings.comments.metadata,
		},
		pageFeedback: {
			allowLike: settings.pageFeedback.allowLike,
		},
		engagement: settings.engagement,
	};
}

function buildSettingsPatch(
	action: SiteSettingsActionPayload["action"],
): Parameters<AdminManagementService["updateSettings"]>[1] {
	switch (action) {
		case "disable_comments":
			return { comments: { enabled: false } };
		case "disable_visitors":
			return {
				engagement: {
					visitors: { enabled: false },
				},
			};
		case "disable_page_views":
			return {
				engagement: {
					pageViews: { enabled: false },
				},
			};
		case "disable_page_reactions":
			return {
				pageFeedback: { allowLike: false },
				engagement: {
					pageLikes: { enabled: false },
					commentVotes: { enabled: false },
				},
			};
		case "disable_metadata_persistence":
			return {
				comments: {
					metadata: {
						collectIp: false,
						collectUserAgent: false,
						ipRegion: { enabled: false },
						device: { enabled: false, display: { enabled: false } },
					},
				},
			};
		case "elevate_captcha":
			return { comments: { captcha: { mode: "always" } } };
	}
}

export async function runSiteSettingsActionTask(
	payload: SiteSettingsActionPayload,
	context: TaskRunnerContext,
) {
	const service = context.services.siteSettingsAction;
	if (!service) {
		throw new Error("Task service missing: siteSettingsAction");
	}
	await context.writeEvent({
		eventType: payload.restore
			? "site_settings_restore_precondition_checked"
			: "site_settings_action_precondition_checked",
		message: payload.restore
			? "site_settings_restore_precondition_checked"
			: "site_settings_action_precondition_checked",
		data: {
			siteKey: payload.siteKey,
			action: payload.action,
			ttlSec: payload.ttlSec,
			restore: payload.restore === true,
		},
	});
	return service.applyAction({
		...payload,
		runId: context.runId,
		actorUserId:
			context.actor.type === "admin_user" && context.actor.id
				? Number(context.actor.id)
				: undefined,
	});
}
