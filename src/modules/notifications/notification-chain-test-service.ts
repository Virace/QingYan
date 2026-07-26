import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, lt, or } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	adminUsers,
	commenterNotificationPreferences,
	comments,
	pageThreads,
	siteSettings,
	sites,
	taskRuns,
} from "../../db/schema";
import { AppError, ResourceNotFoundError } from "../shared/errors";
import { TaskRunRepository } from "../tasks/task-run-repository";
import type {
	NotificationDeliveryRecord,
	TaskRunRecord,
	TaskRunStatus,
} from "../tasks/types";
import { BackendUserNotificationPlanner } from "./backend-user-notification-planner";
import { CommentNotificationPlanner } from "./comment-notification-planner";
import {
	hashNotificationEmail,
	normalizeNotificationEmail,
} from "./email-address-policy";
import {
	type NotificationDiagnosticFlow,
	type NotificationDiagnosticIssue,
	NotificationDiagnosticsService,
} from "./notification-diagnostics-service";

export type NotificationChainTestStatus =
	| "checking"
	| "blocked"
	| "queued"
	| "running"
	| "passed"
	| "failed"
	| "timed_out";

type PreferenceSnapshot =
	| {
			existed: false;
	  }
	| {
			existed: true;
			record: typeof commenterNotificationPreferences.$inferSelect;
	  };

type ChainTestProgress = {
	threadId: number;
	pageKey: string;
	rootCommentId: string;
	replyCommentId: string;
	adminTaskIds: string[];
	commenterTaskIds: string[];
	commenterEmailHash: string;
	preferenceSnapshot: PreferenceSnapshot;
	cleanupCompleted: boolean;
	timeoutAt: string;
};

type ChainTestOptions = {
	diagnostics?: NotificationDiagnosticsService;
	now?: () => Date;
	timeoutMs?: number;
	cooldownMs?: number;
	onTerminal?: (input: {
		runId: string;
		siteKey: string;
		actorUserId: number | null;
		status: "passed" | "failed" | "timed_out";
		adminSentCount: number;
		commenterSentCount: number;
	}) => Promise<void>;
};

type DeliveryResult = {
	deliveryId: string;
	recipient: string;
	status: string;
	providerMessageId?: string;
	error?: {
		kind: string;
		message: string;
	};
};

type FlowResult = {
	status: NotificationChainTestStatus;
	taskIds: string[];
	deliveries: DeliveryResult[];
};

export interface NotificationChainTestResult {
	runId: string;
	status: NotificationChainTestStatus;
	createdAt: string;
	finishedAt: string | null;
	flows: {
		adminComment: FlowResult;
		commenterReply: FlowResult;
	};
	message: string;
}

const terminalTaskStatuses = new Set<TaskRunStatus>([
	"succeeded",
	"failed",
	"skipped",
	"blocked",
	"suppressed",
	"cancelled",
]);

function parseProgress(progress: unknown): ChainTestProgress | null {
	if (!progress || typeof progress !== "object") {
		return null;
	}
	const value = progress as Partial<ChainTestProgress>;
	if (
		typeof value.threadId !== "number" ||
		typeof value.pageKey !== "string" ||
		typeof value.rootCommentId !== "string" ||
		typeof value.replyCommentId !== "string" ||
		!Array.isArray(value.adminTaskIds) ||
		!Array.isArray(value.commenterTaskIds) ||
		typeof value.commenterEmailHash !== "string" ||
		typeof value.timeoutAt !== "string" ||
		typeof value.cleanupCompleted !== "boolean" ||
		!value.preferenceSnapshot
	) {
		return null;
	}
	return value as ChainTestProgress;
}

function safeDeliveryError(error: unknown): DeliveryResult["error"] {
	if (!error || typeof error !== "object") {
		return undefined;
	}
	const value = error as { kind?: unknown; message?: unknown };
	if (typeof value.kind !== "string" || typeof value.message !== "string") {
		return undefined;
	}
	return {
		kind: value.kind,
		message: value.message,
	};
}

function selectedAdminFlow(
	defaultStatus: string,
	flows: NotificationDiagnosticFlow[],
) {
	const key =
		defaultStatus === "pending"
			? "admin_comment_pending_email"
			: "admin_comment_approved_email";
	return flows.find((flow) => flow.key === key);
}

function uniqueIssues(
	issues: NotificationDiagnosticIssue[],
): NotificationDiagnosticIssue[] {
	const seen = new Set<string>();
	return issues.filter((item) => {
		const key = `${item.code}:${item.path ?? ""}`;
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

export class NotificationChainTestService {
	private readonly tasks: TaskRunRepository;
	private readonly diagnostics: NotificationDiagnosticsService;
	private readonly backendPlanner: BackendUserNotificationPlanner;
	private readonly commenterPlanner: CommentNotificationPlanner;
	private readonly timeoutMs: number;
	private readonly cooldownMs: number;

	public constructor(
		private readonly db: AppDatabase,
		private readonly options: ChainTestOptions = {},
	) {
		this.tasks = new TaskRunRepository(db);
		this.diagnostics =
			options.diagnostics ?? new NotificationDiagnosticsService(db);
		this.backendPlanner = new BackendUserNotificationPlanner(db);
		this.commenterPlanner = new CommentNotificationPlanner(db);
		this.timeoutMs = options.timeoutMs ?? 5 * 60_000;
		this.cooldownMs = options.cooldownMs ?? 60_000;
	}

	public async start(input: {
		siteKey: string;
		commenterEmail: string;
		actorUserId: number;
		requestId?: string;
	}): Promise<{ runId: string; status: "queued" }> {
		await this.reconcileStaleRuns();
		const context = await this.loadSiteContext(
			input.siteKey,
			input.actorUserId,
		);
		await this.assertNoActiveOrCoolingRun(context.site.id);

		const diagnostics = await this.diagnostics.diagnoseCommenterEmail(
			input.siteKey,
			input.commenterEmail,
		);
		const defaultStatus =
			context.settings.defaultStatus === "pending" ||
			context.settings.defaultStatus === "approved"
				? context.settings.defaultStatus
				: null;
		const adminFlow = selectedAdminFlow(
			context.settings.defaultStatus,
			diagnostics.flows,
		);
		const commenterFlow = diagnostics.flows.find(
			(flow) => flow.key === "commenter_reply_email",
		);
		const blockers = uniqueIssues([
			...(adminFlow?.blockers ?? []),
			...(commenterFlow?.blockers ?? []),
		]);
		if (!defaultStatus || !adminFlow) {
			blockers.push({
				code: "unsupported_default_comment_status",
				path: "comments.defaultStatus",
				message: "当前默认评论状态不能用于通知链路测试。",
			});
		}
		if (blockers.length > 0) {
			throw new AppError(
				409,
				"NOTIFICATION_CHAIN_TEST_BLOCKED",
				"当前配置无法启动评论通知链路测试。",
				{ blockers },
			);
		}
		if (!defaultStatus) {
			throw new Error("Expected a supported default comment status.");
		}

		const commenterEmail = normalizeNotificationEmail(input.commenterEmail);
		const commenterEmailHash = hashNotificationEmail(commenterEmail);
		if (!commenterEmailHash) {
			throw new AppError(
				409,
				"NOTIFICATION_CHAIN_TEST_BLOCKED",
				"当前配置无法启动评论通知链路测试。",
				{
					blockers: [
						{
							code: "commenter_email_invalid",
							path: "commenterEmail",
							message: "评论者邮箱不符合通知邮箱策略。",
						},
					],
				},
			);
		}

		const now = this.now();
		const runId = `task_${randomUUID().replaceAll("-", "")}`;
		const rootCommentId = `notification_test_root_${randomUUID().replaceAll("-", "")}`;
		const replyCommentId = `notification_test_reply_${randomUUID().replaceAll("-", "")}`;
		const pageKey = `notification-test:${runId}`;
		let preferenceSnapshot: PreferenceSnapshot | null = null;
		let threadId: number | null = null;
		let adminTaskIds: string[] = [];
		let commenterTaskIds: string[] = [];
		const createdChildTaskIds: string[] = [];

		await this.tasks.create({
			id: runId,
			type: "notification_chain_test",
			category: "notification",
			status: "running",
			siteId: context.site.id,
			siteKey: context.site.siteKey,
			actorType: "admin_user",
			actorId: String(input.actorUserId),
			subjectType: "notification_chain_test",
			subjectId: runId,
			concurrencyKey: `notification_chain_test:${context.site.id}`,
			payloadSummary: {
				commenterEmail,
				defaultCommentStatus: defaultStatus,
			},
			payload: {
				commenterEmail,
				defaultCommentStatus: defaultStatus,
				pageKey,
				rootCommentId,
				replyCommentId,
				requestId: input.requestId ?? null,
			},
			startedAt: now.toISOString(),
		});

		try {
			preferenceSnapshot = await this.prepareCommenterPreference({
				siteId: context.site.id,
				email: commenterEmail,
				emailHash: commenterEmailHash,
			});
			const initialProgress: ChainTestProgress = {
				threadId: 0,
				pageKey,
				rootCommentId,
				replyCommentId,
				adminTaskIds: [],
				commenterTaskIds: [],
				commenterEmailHash,
				preferenceSnapshot,
				cleanupCompleted: false,
				timeoutAt: new Date(now.getTime() + this.timeoutMs).toISOString(),
			};
			await this.tasks.updateProgress(runId, initialProgress);
			const [thread] = await this.db
				.insert(pageThreads)
				.values({
					siteId: context.site.id,
					pageKey,
					pageTitle: "QingYan 评论通知链路测试",
					pageUrl: null,
					kind: "notification_test",
					commentCount: 2,
					rootCommentCount: 1,
				})
				.returning();
			if (!thread) {
				throw new Error("Internal notification test thread was not created.");
			}
			threadId = thread.id;
			await this.tasks.updateProgress(runId, {
				...initialProgress,
				threadId: thread.id,
			});
			await this.db.insert(comments).values({
				id: rootCommentId,
				siteId: context.site.id,
				pageThreadId: thread.id,
				status: defaultStatus,
				authorIdentity: "visitor",
				authorName: "通知链路测试评论者",
				authorEmail: commenterEmail,
				authorEmailHash: commenterEmailHash,
				contentRaw: "QingYan 评论通知链路测试：评论 A",
				contentHtml: "<p>QingYan 评论通知链路测试：评论 A</p>",
			});

			const adminPlan = await this.backendPlanner.planForCommentEvent(
				{
					source: "system",
					siteId: context.site.id,
					siteKey: context.site.siteKey,
					commentId: rootCommentId,
					pageKey,
					status: defaultStatus,
					previousStatus: null,
					authorUserId: null,
					contentRaw: "QingYan 评论通知链路测试：评论 A",
				},
				{ channelFilter: ["email"] },
			);
			createdChildTaskIds.push(...adminPlan.tasks.map((task) => task.id));
			adminTaskIds = adminPlan.tasks
				.filter((task) =>
					adminPlan.deliveries.some(
						(delivery) => delivery.taskRunId === task.id,
					),
				)
				.map((task) => task.id);
			if (adminTaskIds.length === 0) {
				throw new AppError(
					409,
					"NOTIFICATION_CHAIN_TEST_NO_ADMIN_DELIVERY",
					"当前配置没有生成可立即发送的站点人员邮件。",
				);
			}
			await this.tasks.updateProgress(runId, {
				...initialProgress,
				threadId: thread.id,
				adminTaskIds,
			});

			if (defaultStatus === "pending") {
				await this.db
					.update(comments)
					.set({
						status: "approved",
						updatedAt: now.toISOString(),
					})
					.where(eq(comments.id, rootCommentId));
			}
			await this.db.insert(comments).values({
				id: replyCommentId,
				siteId: context.site.id,
				pageThreadId: thread.id,
				parentId: rootCommentId,
				authorUserId: context.actor.id,
				authorIdentity: "staff",
				status: "approved",
				authorName: context.actor.displayName,
				authorEmail: context.actor.email,
				contentRaw: "QingYan 评论通知链路测试：站点人员回复",
				contentHtml: "<p>QingYan 评论通知链路测试：站点人员回复</p>",
			});
			const commenterPlan = await this.commenterPlanner.planForCommentEvent(
				{
					siteId: context.site.id,
					siteKey: context.site.siteKey,
					pageKey,
					commentId: replyCommentId,
					source: "system",
					actorType: "admin_user",
					actorId: String(context.actor.id),
				},
				{ channelFilter: ["email"] },
			);
			commenterTaskIds = commenterPlan.taskIds;
			createdChildTaskIds.push(...commenterTaskIds);
			if (commenterTaskIds.length === 0) {
				throw new AppError(
					409,
					"NOTIFICATION_CHAIN_TEST_NO_COMMENTER_DELIVERY",
					"当前配置没有生成评论者回复邮件。",
				);
			}

			await this.tasks.updateProgress(runId, {
				threadId: thread.id,
				pageKey,
				rootCommentId,
				replyCommentId,
				adminTaskIds,
				commenterTaskIds,
				commenterEmailHash,
				preferenceSnapshot,
				cleanupCompleted: false,
				timeoutAt: new Date(now.getTime() + this.timeoutMs).toISOString(),
			} satisfies ChainTestProgress);
			return { runId, status: "queued" };
		} catch (error) {
			for (const taskId of createdChildTaskIds) {
				await this.tasks.cancelIfUnclaimed(taskId, {
					code: "notification_chain_test_setup_failed",
				});
			}
			if (threadId !== null && preferenceSnapshot) {
				await this.cleanup({
					threadId,
					pageKey,
					rootCommentId,
					replyCommentId,
					siteId: context.site.id,
					commenterEmailHash,
					preferenceSnapshot,
				});
			} else if (preferenceSnapshot) {
				await this.restoreCommenterPreference({
					siteId: context.site.id,
					emailHash: commenterEmailHash,
					snapshot: preferenceSnapshot,
				});
			}
			await this.tasks.markFailed(runId, {
				code: "notification_chain_test_setup_failed",
				message:
					error instanceof AppError
						? error.message
						: "评论通知链路测试准备失败。",
			});
			await this.options.onTerminal?.({
				runId,
				siteKey: context.site.siteKey,
				actorUserId: input.actorUserId,
				status: "failed",
				adminSentCount: 0,
				commenterSentCount: 0,
			});
			throw error;
		}
	}

	public async get(input: {
		siteKey: string;
		runId: string;
	}): Promise<NotificationChainTestResult> {
		const task = await this.tasks.get(input.runId);
		if (
			task?.type !== "notification_chain_test" ||
			task.siteKey !== input.siteKey
		) {
			throw new ResourceNotFoundError(
				"NOTIFICATION_CHAIN_TEST_NOT_FOUND",
				"评论通知链路测试不存在。",
			);
		}
		const progress = parseProgress(task.progress);
		if (!progress) {
			const failedTask =
				task.status === "running"
					? await this.tasks.markFailed(task.id, {
							code: "notification_chain_test_state_incomplete",
							message: "评论通知链路测试运行状态不完整。",
						})
					: task;
			if (task.status === "running") {
				await this.options.onTerminal?.({
					runId: task.id,
					siteKey: input.siteKey,
					actorUserId:
						task.actorType === "admin_user" && task.actorId
							? Number(task.actorId)
							: null,
					status: "failed",
					adminSentCount: 0,
					commenterSentCount: 0,
				});
			}
			return this.emptyFailedResult(failedTask);
		}

		let timedOut =
			task.status === "running" &&
			this.now().toISOString() >= progress.timeoutAt;
		if (timedOut) {
			for (const taskId of [
				...progress.adminTaskIds,
				...progress.commenterTaskIds,
			]) {
				await this.tasks.cancelIfUnclaimed(taskId, {
					code: "notification_chain_test_timed_out",
				});
			}
		}

		const admin = await this.buildFlow(progress.adminTaskIds, true);
		const commenter = await this.buildFlow(progress.commenterTaskIds, false);
		const allChildrenTerminal = [admin, commenter].every(
			(flow) => flow.status === "passed" || flow.status === "failed",
		);
		let currentTask = task;

		if (!progress.cleanupCompleted && (allChildrenTerminal || timedOut)) {
			const childTasks = await this.tasks.listByIds([
				...progress.adminTaskIds,
				...progress.commenterTaskIds,
			]);
			const hasRunningChild = childTasks.some(
				(child) => !terminalTaskStatuses.has(child.status),
			);
			if (!hasRunningChild) {
				await this.cleanup({
					threadId: progress.threadId,
					pageKey: progress.pageKey,
					rootCommentId: progress.rootCommentId,
					replyCommentId: progress.replyCommentId,
					siteId: task.siteId ?? 0,
					commenterEmailHash: progress.commenterEmailHash,
					preferenceSnapshot: progress.preferenceSnapshot,
				});
				await this.tasks.updateProgress(task.id, {
					...progress,
					cleanupCompleted: true,
				});
			}
		}

		if (task.status === "running") {
			if (timedOut) {
				currentTask = await this.tasks.markFailed(task.id, {
					code: "notification_chain_test_timed_out",
					message: "评论通知链路测试等待邮件投递超时。",
				});
			} else if (admin.status === "passed" && commenter.status === "passed") {
				currentTask = await this.tasks.markSucceeded(task.id, {
					providerAccepted: true,
					adminSentCount: admin.deliveries.filter(
						(delivery) => delivery.status === "sent",
					).length,
					commenterSentCount: commenter.deliveries.filter(
						(delivery) => delivery.status === "sent",
					).length,
				});
			} else if (allChildrenTerminal) {
				currentTask = await this.tasks.markFailed(task.id, {
					code: "notification_chain_test_delivery_failed",
					message: "至少一条评论邮件链路未被 provider 接受。",
				});
			}
		}
		timedOut =
			timedOut ||
			(Boolean(currentTask.error) &&
				(currentTask.error as { code?: unknown }).code ===
					"notification_chain_test_timed_out");

		const status: NotificationChainTestStatus = timedOut
			? "timed_out"
			: currentTask.status === "succeeded"
				? "passed"
				: currentTask.status === "failed"
					? "failed"
					: admin.status === "queued" && commenter.status === "queued"
						? "queued"
						: "running";
		if (
			task.status === "running" &&
			(status === "passed" || status === "failed" || status === "timed_out")
		) {
			await this.options.onTerminal?.({
				runId: currentTask.id,
				siteKey: input.siteKey,
				actorUserId:
					currentTask.actorType === "admin_user" && currentTask.actorId
						? Number(currentTask.actorId)
						: null,
				status,
				adminSentCount: admin.deliveries.filter(
					(delivery) => delivery.status === "sent",
				).length,
				commenterSentCount: commenter.deliveries.filter(
					(delivery) => delivery.status === "sent",
				).length,
			});
		}
		return {
			runId: currentTask.id,
			status,
			createdAt: currentTask.createdAt,
			finishedAt: currentTask.finishedAt,
			flows: {
				adminComment: admin,
				commenterReply: commenter,
			},
			message:
				status === "passed"
					? "两条邮件均已被 provider 接受，请继续核对站点人员和评论者收件箱。"
					: status === "timed_out"
						? "等待邮件投递超时，请检查 worker、队列和 SMTP 服务。"
						: status === "failed"
							? "至少一条评论邮件链路投递失败。"
							: "真实评论邮件正在通过通知队列发送。",
		};
	}

	private now() {
		return this.options.now?.() ?? new Date();
	}

	private async loadSiteContext(siteKey: string, actorUserId: number) {
		const [site] = await this.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, siteKey))
			.limit(1);
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}
		const [settings] = await this.db
			.select({
				defaultStatus: siteSettings.defaultStatus,
			})
			.from(siteSettings)
			.where(eq(siteSettings.siteId, site.id))
			.limit(1);
		const [actor] = await this.db
			.select({
				id: adminUsers.id,
				email: adminUsers.email,
				displayName: adminUsers.displayName,
			})
			.from(adminUsers)
			.where(
				and(eq(adminUsers.id, actorUserId), eq(adminUsers.status, "active")),
			)
			.limit(1);
		if (!settings || !actor) {
			throw new AppError(
				409,
				"NOTIFICATION_CHAIN_TEST_ACTOR_UNAVAILABLE",
				"当前站点人员无法执行评论通知链路测试。",
			);
		}
		return { site, settings, actor };
	}

	private async assertNoActiveOrCoolingRun(siteId: number) {
		const [active] = await this.db
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.siteId, siteId),
					eq(taskRuns.type, "notification_chain_test"),
					eq(taskRuns.status, "running"),
				),
			)
			.limit(1);
		if (active) {
			throw new AppError(
				409,
				"NOTIFICATION_CHAIN_TEST_ACTIVE",
				"该站点已有正在执行的评论通知链路测试。",
				{ runId: active.id },
			);
		}
		const cooldownAfter = new Date(
			this.now().getTime() - this.cooldownMs,
		).toISOString();
		const [recent] = await this.db
			.select({ id: taskRuns.id, finishedAt: taskRuns.finishedAt })
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.siteId, siteId),
					eq(taskRuns.type, "notification_chain_test"),
					inArray(taskRuns.status, ["succeeded", "failed"]),
				),
			)
			.orderBy(desc(taskRuns.finishedAt))
			.limit(1);
		if (recent?.finishedAt && recent.finishedAt >= cooldownAfter) {
			throw new AppError(
				429,
				"NOTIFICATION_CHAIN_TEST_COOLDOWN",
				"评论通知链路测试刚刚完成，请稍后再试。",
				{
					runId: recent.id,
					retryAfterSeconds: Math.ceil(this.cooldownMs / 1000),
				},
			);
		}
	}

	private async prepareCommenterPreference(input: {
		siteId: number;
		email: string;
		emailHash: string;
	}): Promise<PreferenceSnapshot> {
		const [existing] = await this.db
			.select()
			.from(commenterNotificationPreferences)
			.where(
				and(
					eq(commenterNotificationPreferences.siteId, input.siteId),
					eq(commenterNotificationPreferences.emailHash, input.emailHash),
				),
			)
			.limit(1);
		const snapshot: PreferenceSnapshot = existing
			? { existed: true, record: existing }
			: { existed: false };
		if (existing?.unsubscribedAt) {
			throw new AppError(
				409,
				"NOTIFICATION_CHAIN_TEST_BLOCKED",
				"该评论者已明确退订回复邮件。",
				{
					blockers: [
						{
							code: "commenter_unsubscribed",
							path: "commenterEmail",
							message: "该评论者已明确退订回复邮件。",
						},
					],
				},
			);
		}
		const timestamp = this.now().toISOString();
		if (existing) {
			await this.db
				.update(commenterNotificationPreferences)
				.set({
					email: input.email,
					notifyOnReply: true,
					source: "notification_chain_test",
					updatedAt: timestamp,
				})
				.where(eq(commenterNotificationPreferences.id, existing.id));
		} else {
			await this.db.insert(commenterNotificationPreferences).values({
				id: `commenter_pref_${randomUUID().replaceAll("-", "")}`,
				siteId: input.siteId,
				email: input.email,
				emailHash: input.emailHash,
				notifyOnReply: true,
				source: "notification_chain_test",
				createdAt: timestamp,
				updatedAt: timestamp,
			});
		}
		return snapshot;
	}

	private async restoreCommenterPreference(input: {
		siteId: number;
		emailHash: string;
		snapshot: PreferenceSnapshot;
	}) {
		const [current] = await this.db
			.select()
			.from(commenterNotificationPreferences)
			.where(
				and(
					eq(commenterNotificationPreferences.siteId, input.siteId),
					eq(commenterNotificationPreferences.emailHash, input.emailHash),
				),
			)
			.limit(1);
		if (current?.unsubscribedAt) {
			return;
		}
		if (!input.snapshot.existed) {
			await this.db
				.delete(commenterNotificationPreferences)
				.where(
					and(
						eq(commenterNotificationPreferences.siteId, input.siteId),
						eq(commenterNotificationPreferences.emailHash, input.emailHash),
						eq(
							commenterNotificationPreferences.source,
							"notification_chain_test",
						),
					),
				);
			return;
		}
		const record = input.snapshot.record;
		await this.db
			.update(commenterNotificationPreferences)
			.set({
				email: record.email,
				emailHash: record.emailHash,
				notifyOnReply: record.notifyOnReply,
				unsubscribedAt: record.unsubscribedAt,
				source: record.source,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt,
			})
			.where(eq(commenterNotificationPreferences.id, record.id));
	}

	private async buildFlow(
		taskIds: string[],
		adminFlow: boolean,
	): Promise<FlowResult> {
		const tasks = await this.tasks.listByIds(taskIds);
		const deliveries = (
			await Promise.all(
				tasks.map((task) => this.tasks.listDeliveriesForTask(task.id)),
			)
		).flat();
		const deliveryResults = deliveries.map((delivery) =>
			this.serializeDelivery(delivery),
		);
		const allTerminal =
			tasks.length > 0 &&
			tasks.every((task) => terminalTaskStatuses.has(task.status));
		const acceptedCount = deliveries.filter(
			(delivery) => delivery.status === "sent",
		).length;
		let status: NotificationChainTestStatus;
		if (allTerminal) {
			status =
				acceptedCount >= 1 && (adminFlow || acceptedCount === deliveries.length)
					? "passed"
					: "failed";
		} else if (
			tasks.length > 0 &&
			tasks.every((task) =>
				["queued", "delayed", "retrying"].includes(task.status),
			)
		) {
			status = "queued";
		} else {
			status = "running";
		}
		return { status, taskIds, deliveries: deliveryResults };
	}

	private serializeDelivery(
		delivery: NotificationDeliveryRecord,
	): DeliveryResult {
		const error = safeDeliveryError(delivery.lastError);
		return {
			deliveryId: delivery.id,
			recipient: delivery.recipientAddressSnapshot,
			status: delivery.status,
			...(delivery.providerMessageId
				? { providerMessageId: delivery.providerMessageId }
				: {}),
			...(error ? { error } : {}),
		};
	}

	private async cleanup(input: {
		threadId: number;
		pageKey: string;
		rootCommentId: string;
		replyCommentId: string;
		siteId: number;
		commenterEmailHash: string;
		preferenceSnapshot: PreferenceSnapshot;
	}) {
		await this.db
			.delete(comments)
			.where(inArray(comments.id, [input.replyCommentId, input.rootCommentId]));
		await this.db
			.delete(pageThreads)
			.where(
				and(
					eq(pageThreads.siteId, input.siteId),
					eq(pageThreads.kind, "notification_test"),
					or(
						eq(pageThreads.id, input.threadId),
						eq(pageThreads.pageKey, input.pageKey),
					),
				),
			);
		await this.restoreCommenterPreference({
			siteId: input.siteId,
			emailHash: input.commenterEmailHash,
			snapshot: input.preferenceSnapshot,
		});
	}

	private async reconcileStaleRuns() {
		const staleBefore = new Date(
			this.now().getTime() - this.timeoutMs,
		).toISOString();
		const rows = await this.db
			.select({ id: taskRuns.id, siteKey: taskRuns.siteKey })
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.type, "notification_chain_test"),
					eq(taskRuns.status, "running"),
					lt(taskRuns.updatedAt, staleBefore),
				),
			);
		for (const row of rows) {
			if (row.siteKey) {
				await this.get({ siteKey: row.siteKey, runId: row.id });
			}
		}
	}

	private emptyFailedResult(task: TaskRunRecord): NotificationChainTestResult {
		return {
			runId: task.id,
			status: "failed",
			createdAt: task.createdAt,
			finishedAt: task.finishedAt,
			flows: {
				adminComment: { status: "failed", taskIds: [], deliveries: [] },
				commenterReply: { status: "failed", taskIds: [], deliveries: [] },
			},
			message: "评论通知链路测试没有完整的运行状态。",
		};
	}
}
