import type { AdminTaskCenterItem } from "@/api/ops";
import { notificationTaskDetails } from "../content/notification-ui-model";

export interface TaskSummaryMetric {
	label: string;
	value: string;
}

export interface TaskSummaryError {
	label: string;
	message: string;
}

export interface TaskSummaryRawSection {
	label: "scope" | "progress" | "result" | "error";
	value: unknown;
}

export interface TaskSummaryModel {
	title: string;
	description: string;
	metrics: TaskSummaryMetric[];
	errors: TaskSummaryError[];
	rawSections: TaskSummaryRawSection[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAtNumber(value: unknown, key: string) {
	if (!isRecord(value)) {
		return undefined;
	}
	const item = value[key];
	return typeof item === "number" && Number.isFinite(item)
		? String(item)
		: undefined;
}

function valueAtString(value: unknown, key: string) {
	if (!isRecord(value)) {
		return undefined;
	}
	const item = value[key];
	return typeof item === "string" && item.length > 0 ? item : undefined;
}

function valueAtStringArray(value: unknown, key: string) {
	if (!isRecord(value)) {
		return undefined;
	}
	const item = value[key];
	if (!Array.isArray(item)) {
		return undefined;
	}
	const strings = item.filter(
		(value): value is string => typeof value === "string" && value.length > 0,
	);
	return strings.length > 0 ? strings : undefined;
}

function formatError(value: unknown) {
	if (typeof value === "string") {
		return value;
	}
	return (
		valueAtString(value, "message") ??
		valueAtString(value, "error") ??
		valueAtString(value, "code")
	);
}

function rawSections(job: AdminTaskCenterItem): TaskSummaryRawSection[] {
	return [
		{ label: "scope" as const, value: job.scope },
		{ label: "progress" as const, value: job.progress },
		{ label: "result" as const, value: job.result },
		{ label: "error" as const, value: job.error },
	].filter((section) => section.value !== null && section.value !== undefined);
}

function genericSummary(job: AdminTaskCenterItem): TaskSummaryModel {
	const queueState = "queueState" in job ? job.queueState : undefined;
	const waitingDescription =
		isRecord(queueState) && typeof queueState.waitingDescription === "string"
			? ` ${queueState.waitingDescription}`
			: "";
	const errorMessage = formatError(job.error);

	return {
		title: String(job.type),
		description: `任务 ${job.id}，站点 ${job.siteKey ?? "-"}。${waitingDescription}`,
		metrics: [
			{ label: "状态", value: job.status },
			{ label: "尝试", value: `${job.attempts} / ${job.maxAttempts}` },
		],
		errors: errorMessage ? [{ label: "错误", message: errorMessage }] : [],
		rawSections: rawSections(job),
	};
}

function firstNumber(...values: Array<string | undefined>) {
	return values.find((value) => value !== undefined) ?? "-";
}

export function summarizeTask(job: AdminTaskCenterItem): TaskSummaryModel {
	const generic = genericSummary(job);

	if (job.category === "notification") {
		const details = notificationTaskDetails(job);
		const errorMessage = formatError(job.error);
		return {
			...generic,
			title: `通知任务 / ${job.type}`,
			description: `任务 ${job.id}，站点 ${job.siteKey ?? "-"}，事件 ${details.event}，收件人 ${details.recipientAddress}。`,
			metrics: [
				...generic.metrics,
				{ label: "事件", value: details.event },
				{ label: "通道", value: details.channel },
				{ label: "渠道配置", value: details.channelConfig },
				{ label: "收件人类型", value: details.recipientType },
				{ label: "收件地址", value: details.recipientAddress },
				{ label: "队列", value: job.queueBackend },
				{ label: "下次重试", value: job.runAfter ?? "-" },
				{ label: "Provider Message ID", value: details.providerMessageId },
			],
			errors:
				errorMessage || details.providerError !== "-"
					? [
							...(errorMessage
								? [{ label: "错误", message: errorMessage }]
								: []),
							...(details.providerError !== "-"
								? [
										{
											label: "Provider",
											message: details.providerError,
										},
									]
								: []),
						]
					: [],
		};
	}

	if (job.type === "page_source_refresh") {
		const sitemapUrls =
			valueAtStringArray(job.payload, "sitemapUrls") ??
			valueAtStringArray(job.input, "sitemapUrls");
		return {
			...generic,
			title: "页面来源刷新",
			metrics: [
				...generic.metrics,
				{
					label: "sitemap",
					value: sitemapUrls ? `${sitemapUrls.length} 个` : "-",
				},
				{
					label: "处理页面",
					value: firstNumber(
						valueAtNumber(job.result, "processed"),
						valueAtNumber(job.progress, "processed"),
					),
				},
				{
					label: "新增页面",
					value: firstNumber(
						valueAtNumber(job.result, "created"),
						valueAtNumber(job.progress, "created"),
					),
				},
				{
					label: "更新页面",
					value: firstNumber(
						valueAtNumber(job.result, "updated"),
						valueAtNumber(job.progress, "updated"),
					),
				},
				{
					label: "失败",
					value: firstNumber(
						valueAtNumber(job.result, "failed"),
						valueAtNumber(job.progress, "failed"),
					),
				},
			],
		};
	}

	if (job.type === "page_metadata_refresh") {
		return {
			...generic,
			title: "页面 Title 刷新",
			metrics: [
				...generic.metrics,
				{
					label: "处理页面",
					value: firstNumber(
						valueAtNumber(job.result, "processed"),
						valueAtNumber(job.progress, "processed"),
					),
				},
				{
					label: "更新页面",
					value: valueAtNumber(job.result, "updated") ?? "-",
				},
				{ label: "失败", value: valueAtNumber(job.result, "failed") ?? "-" },
			],
		};
	}

	if (job.type === "ip_region_update") {
		return {
			...generic,
			title: "IP 库更新",
			metrics: [
				...generic.metrics,
				{
					label: "刷新评论",
					value: valueAtNumber(job.result, "refreshedComments") ?? "-",
				},
			],
		};
	}

	if (job.type === "comment_ip_refresh") {
		return {
			...generic,
			title: "评论 IP 刷新",
			metrics: [
				...generic.metrics,
				{ label: "成功", value: valueAtNumber(job.result, "updated") ?? "-" },
				{ label: "失败", value: valueAtNumber(job.result, "failed") ?? "-" },
			],
		};
	}

	return generic;
}
