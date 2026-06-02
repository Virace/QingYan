import { describe, expect, it } from "vitest";

import type {
	TaskCenterItem,
	TaskRunCenterItem,
} from "../../apps/admin/src/api/ops";
import { summarizeTask } from "../../apps/admin/src/components/admin/task-summary-model";

function task(
	input: Partial<TaskCenterItem> & { type: TaskCenterItem["type"] },
) {
	const { type, ...rest } = input;
	return {
		source: "maintenance",
		id: "job_1",
		type,
		status: input.status ?? "succeeded",
		siteKey: input.siteKey ?? "default",
		scope: input.scope ?? null,
		progress: input.progress ?? null,
		result: input.result ?? null,
		error: input.error ?? null,
		runAfter: null,
		attempts: input.attempts ?? 1,
		maxAttempts: input.maxAttempts ?? 3,
		retryDelaySec: 60,
		priority: 0,
		concurrencyKey: null,
		lastHeartbeatAt: null,
		createdAt: "2026-05-30T00:00:00.000Z",
		startedAt: null,
		finishedAt: null,
		updatedAt: "2026-05-30T00:00:00.000Z",
		queueState: {
			waitingReason: "terminal",
			waitingDescription: "任务已经结束。",
			readyAt: null,
		},
		...rest,
	} satisfies TaskCenterItem;
}

function notificationTask(input: Partial<TaskRunCenterItem> = {}) {
	return {
		source: "task_run",
		id: "task_1",
		queueBackend: "database",
		queueMessageId: "msg_1",
		type: "comment_notification",
		category: "notification",
		status: "retrying",
		siteId: 1,
		siteKey: "default",
		actorType: "system",
		actorId: null,
		subjectType: "comment",
		subjectId: "comment_1",
		payloadSummary: {
			eventFamily: "admin_comment_pending",
			channel: "email",
			channelConfigName: "默认邮件",
			recipientType: "backend_user",
			recipientAddressSnapshot: "admin@example.com",
		},
		payload: null,
		scope: null,
		progress: null,
		result: { providerMessageId: "provider_msg_1" },
		error: { providerMessage: "smtp temp fail" },
		idempotencyKey: "notification:1",
		runAfter: "2026-06-02T00:05:00.000Z",
		attempts: 2,
		maxAttempts: 3,
		createdAt: "2026-06-02T00:00:00.000Z",
		startedAt: null,
		finishedAt: null,
		updatedAt: "2026-06-02T00:01:00.000Z",
		queueState: {
			waitingReason: "retry_wait",
			waitingDescription: "等待重试。",
			readyAt: "2026-06-02T00:05:00.000Z",
		},
		...input,
	} satisfies TaskRunCenterItem;
}

describe("task summary model", () => {
	it("summarizes page source refresh jobs and preserves raw sections", () => {
		const scope = { sourceId: "source_1", siteKey: "default" };
		const progress = { processed: 8, created: 3, updated: 2, failed: 1 };
		const result = { processed: 12, created: 5, updated: 4, failed: 2 };

		const summary = summarizeTask(
			task({
				type: "page_source_refresh",
				scope,
				progress,
				result,
			}),
		);

		expect(summary.title).toBe("页面来源刷新");
		expect(summary.description).toContain("default");
		expect(summary.metrics).toEqual(
			expect.arrayContaining([
				{ label: "状态", value: "succeeded" },
				{ label: "尝试", value: "1 / 3" },
				{ label: "处理页面", value: "12" },
				{ label: "新增页面", value: "5" },
				{ label: "更新页面", value: "4" },
				{ label: "失败", value: "2" },
			]),
		);
		expect(summary.rawSections).toEqual([
			{ label: "scope", value: scope },
			{ label: "progress", value: progress },
			{ label: "result", value: result },
		]);
	});

	it("summarizes page metadata refresh jobs with progress fallback", () => {
		const summary = summarizeTask(
			task({
				type: "page_metadata_refresh",
				progress: { processed: 4 },
				result: { updated: 2, failed: 1 },
			}),
		);

		expect(summary.title).toBe("页面 Title 刷新");
		expect(summary.metrics).toEqual(
			expect.arrayContaining([
				{ label: "处理页面", value: "4" },
				{ label: "更新页面", value: "2" },
				{ label: "失败", value: "1" },
			]),
		);
	});

	it("summarizes IP update and comment IP refresh jobs", () => {
		const ipUpdate = summarizeTask(
			task({
				type: "ip_region_update",
				result: { refreshedComments: 15 },
			}),
		);
		const commentRefresh = summarizeTask(
			task({
				type: "comment_ip_refresh",
				result: { updated: 9, failed: 2 },
			}),
		);

		expect(ipUpdate.title).toBe("IP 库更新");
		expect(ipUpdate.metrics).toContainEqual({ label: "刷新评论", value: "15" });
		expect(commentRefresh.title).toBe("评论 IP 刷新");
		expect(commentRefresh.metrics).toEqual(
			expect.arrayContaining([
				{ label: "成功", value: "9" },
				{ label: "失败", value: "2" },
			]),
		);
	});

	it("returns a generic summary for unknown task types", () => {
		const summary = summarizeTask(
			task({
				type: "custom_cleanup" as TaskCenterItem["type"],
				status: "failed",
				error: { message: "boom" },
			}),
		);

		expect(summary.title).toBe("custom_cleanup");
		expect(summary.description).toContain("job_1");
		expect(summary.metrics).toEqual(
			expect.arrayContaining([
				{ label: "状态", value: "failed" },
				{ label: "尝试", value: "1 / 3" },
			]),
		);
		expect(summary.errors).toEqual([{ label: "错误", message: "boom" }]);
		expect(summary.rawSections).toEqual([
			{ label: "error", value: { message: "boom" } },
		]);
	});

	it("treats missing queueState as compatible input", () => {
		const summary = summarizeTask(
			task({
				type: "comment_ip_refresh",
				result: { updated: 1 },
			}),
		);

		expect(summary.description).not.toContain("undefined");
	});

	it("summarizes notification task rows with delivery trace fields", () => {
		const summary = summarizeTask(notificationTask());

		expect(summary.title).toBe("通知任务 / comment_notification");
		expect(summary.description).toContain("事件 admin_comment_pending");
		expect(summary.description).toContain("收件人 admin@example.com");
		expect(summary.metrics).toEqual(
			expect.arrayContaining([
				{ label: "状态", value: "retrying" },
				{ label: "尝试", value: "2 / 3" },
				{ label: "事件", value: "admin_comment_pending" },
				{ label: "通道", value: "email" },
				{ label: "渠道配置", value: "默认邮件" },
				{ label: "收件人类型", value: "backend_user" },
				{ label: "收件地址", value: "admin@example.com" },
				{ label: "队列", value: "database" },
				{ label: "下次重试", value: "2026-06-02T00:05:00.000Z" },
				{ label: "Provider Message ID", value: "provider_msg_1" },
			]),
		);
		expect(summary.errors).toContainEqual({
			label: "Provider",
			message: "smtp temp fail",
		});
	});
});
