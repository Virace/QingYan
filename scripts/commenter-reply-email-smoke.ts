import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../src/config/load-config";
import { createDatabaseClients } from "../src/db/client";
import { EmailNotificationChannel } from "../src/modules/notifications/channels/email-channel";
import { createNodemailerSmtpSender } from "../src/modules/notifications/channels/smtp-sender";
import { EmailReputationRepository } from "../src/modules/notifications/email-reputation-repository";
import { NotificationTemplateContextBuilder } from "../src/modules/notifications/notification-template-context";
import { NotificationWorker } from "../src/modules/notifications/notification-worker";
import { RuntimeSystemSettingsService } from "../src/modules/system-settings/service";
import { TaskRunRepository } from "../src/modules/tasks/task-run-repository";
import type {
	NotificationDeliveryRecord,
	TaskQueue,
	TaskQueuePayload,
	TaskRunRecord,
} from "../src/modules/tasks/types";

type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

export interface SmokeConfig {
	apiBase: string;
	adminUsername: string;
	adminPassword: string;
	adminCaptchaValue: string;
	recipientEmail: string;
	siteKey: string;
	pageTitle: string;
	pagePath: string;
	pageOrigin: string;
	authorName: string;
	replyAuthorName: string;
	waitForManualConfirmation: boolean;
	unsubscribeUrl?: string;
	existingParentCommentId?: string;
	configPath: string;
	workerLimit: number;
}

type AdminAuth = {
	cookieHeader: string;
	csrfToken: string;
	origin: string;
};

type RequestOptions = {
	method?: string;
	headers?: Record<string, string>;
	body?: JsonValue;
	expect?: number[];
};

type FetchJsonResult<T> = {
	status: number;
	headers: Headers;
	body: T;
};

type SmokeSettingsPatch = {
	comments: {
		enabled: true;
		defaultStatus: "approved";
		captcha: {
			mode: "never";
		};
	};
	pageRegistry: {
		mode: "discovery";
	};
	notifications: {
		commenter: {
			replyEmailEnabled: true;
		};
	};
};

type SmokeSiteCreatePayload = {
	siteKey: string;
	name: string;
	allowedOrigins: string[];
};

type SmokeDeliverySummary = {
	id: string;
	taskRunId: string;
	channel: string;
	recipientType: string;
	recipientAddressSnapshot: string;
	templateKey: string;
	status: string;
	providerMessageId: string | null;
	sentAt: string | null;
	lastError: unknown;
};

type WorkerRunResult = {
	databaseFile: string;
	processed: number;
	tasks: Array<{
		id: string;
		status: string;
		type: string;
		category: string;
		result: unknown;
		error: unknown;
		deliveries: SmokeDeliverySummary[];
	}>;
};

const DEFAULT_API_BASE = "http://127.0.0.1:4401/qingyan";
const DEFAULT_PAGE_PATH = "/posts/commenter-email-smoke/";
const DEFAULT_PAGE_ORIGIN = "http://localhost:4321";
const DEFAULT_ADMIN_CAPTCHA_VALUE = "2468";
const DEFAULT_CONFIG_PATH = "config/qingyan.yml";
const DEFAULT_WORKER_LIMIT = 5;

function readBoolean(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) {
		return fallback;
	}
	return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/u, "");
}

function normalizeLeadingSlash(value: string): string {
	const trimmed = value.trim();
	return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function readPositiveInteger(
	value: string | undefined,
	fallback: number,
): number {
	if (value === undefined) {
		return fallback;
	}
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveSmokeConfig(
	environment: NodeJS.ProcessEnv = process.env,
): SmokeConfig {
	const pagePath = normalizeLeadingSlash(
		environment.QINGYAN_SMOKE_PAGE_PATH ?? DEFAULT_PAGE_PATH,
	);
	return {
		apiBase: trimTrailingSlash(
			environment.QINGYAN_SMOKE_API_BASE ?? DEFAULT_API_BASE,
		),
		adminUsername: environment.QINGYAN_SMOKE_ADMIN_USERNAME ?? "admin",
		adminPassword: environment.QINGYAN_SMOKE_ADMIN_PASSWORD ?? "admin",
		adminCaptchaValue:
			environment.QINGYAN_SMOKE_ADMIN_CAPTCHA_VALUE ??
			environment.QINGYAN_DEV_CAPTCHA_ANSWER ??
			DEFAULT_ADMIN_CAPTCHA_VALUE,
		recipientEmail:
			environment.QINGYAN_SMOKE_COMMENTER_EMAIL ?? "virace2024@gmail.com",
		siteKey: environment.QINGYAN_SMOKE_SITE_KEY ?? "fangyuan",
		pageTitle: environment.QINGYAN_SMOKE_PAGE_TITLE ?? "Commenter Email Smoke",
		pagePath,
		pageOrigin: trimTrailingSlash(
			environment.QINGYAN_SMOKE_PAGE_ORIGIN ?? DEFAULT_PAGE_ORIGIN,
		),
		authorName: environment.QINGYAN_SMOKE_AUTHOR_NAME ?? "Virace Smoke",
		replyAuthorName:
			environment.QINGYAN_SMOKE_REPLY_AUTHOR_NAME ?? "QingYan Admin",
		waitForManualConfirmation: readBoolean(
			environment.QINGYAN_SMOKE_WAIT_FOR_CONFIRMATION,
			false,
		),
		unsubscribeUrl: environment.QINGYAN_SMOKE_UNSUBSCRIBE_URL,
		existingParentCommentId:
			environment.QINGYAN_SMOKE_EXISTING_PARENT_COMMENT_ID,
		configPath:
			environment.QINGYAN_SMOKE_CONFIG_PATH ??
			environment.QINGYAN_CONFIG_PATH ??
			DEFAULT_CONFIG_PATH,
		workerLimit: readPositiveInteger(
			environment.QINGYAN_SMOKE_WORKER_LIMIT,
			DEFAULT_WORKER_LIMIT,
		),
	};
}

export function buildSmokeUrls(config: SmokeConfig) {
	const pageUrl = `${config.pageOrigin}${config.pagePath}`;
	const apiUrl = (path: string) =>
		`${config.apiBase}${normalizeLeadingSlash(path)}`;
	return {
		pageUrl,
		bootstrap: apiUrl(
			`/api/comments/bootstrap?siteKey=${encodeURIComponent(
				config.siteKey,
			)}&pageTitle=${encodeURIComponent(config.pageTitle)}`,
		),
		comments: apiUrl("/api/comments"),
		adminCaptcha: apiUrl("/api/admin/session/captcha"),
		adminLogin: apiUrl("/api/admin/session/login"),
		adminSystemSettings: apiUrl("/api/admin/system-settings"),
		adminSiteSettings: apiUrl(
			`/api/admin/sites/${encodeURIComponent(config.siteKey)}/settings`,
		),
		adminSites: apiUrl("/api/admin/sites"),
		adminSite: apiUrl(`/api/admin/sites/${encodeURIComponent(config.siteKey)}`),
		adminPageRegistryPendingApprove: apiUrl(
			"/api/admin/page-registry/pending/approve",
		),
		thread: apiUrl(
			`/api/comments/thread?siteKey=${encodeURIComponent(
				config.siteKey,
			)}&pageKey=${encodeURIComponent(config.pagePath)}&limit=100`,
		),
		adminTasksRuns: apiUrl("/api/admin/tasks/runs"),
	};
}

export function summarizeSmokeConfig(config: SmokeConfig) {
	return {
		apiBase: config.apiBase,
		siteKey: config.siteKey,
		pagePath: config.pagePath,
		pageOrigin: config.pageOrigin,
		recipientEmail: config.recipientEmail,
		adminUsername: config.adminUsername,
		adminPassword: "[REDACTED]",
		adminCaptchaValue: "[REDACTED]",
		waitForManualConfirmation: config.waitForManualConfirmation,
		existingParentCommentId: config.existingParentCommentId,
		configPath: config.configPath,
		workerLimit: config.workerLimit,
	};
}

export function buildSmokeSettingsPatch(): SmokeSettingsPatch {
	return {
		comments: {
			enabled: true,
			defaultStatus: "approved",
			captcha: {
				mode: "never",
			},
		},
		pageRegistry: {
			mode: "discovery",
		},
		notifications: {
			commenter: {
				replyEmailEnabled: true,
			},
		},
	};
}

export function buildSmokeSiteCreatePayload(
	config: SmokeConfig,
): SmokeSiteCreatePayload {
	return {
		siteKey: config.siteKey,
		name: `QingYan Smoke ${config.siteKey}`,
		allowedOrigins: [config.pageOrigin],
	};
}

export function isSmokeCliEntryPoint(
	moduleLocation: string,
	argvEntry: string | undefined,
): boolean {
	if (!argvEntry) {
		return false;
	}
	const currentFile = moduleLocation.startsWith("file:")
		? fileURLToPath(moduleLocation)
		: moduleLocation;
	return path.resolve(currentFile) === path.resolve(argvEntry);
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} response is not an object.`);
	}
	return value as Record<string, unknown>;
}

function readString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`Expected ${label} to be a non-empty string.`);
	}
	return value;
}

async function fetchJson<T = unknown>(
	url: string,
	options: RequestOptions = {},
): Promise<FetchJsonResult<T>> {
	const response = await fetch(url, {
		method: options.method ?? "GET",
		headers: {
			...(options.body === undefined
				? {}
				: { "content-type": "application/json" }),
			...options.headers,
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const text = await response.text();
	const body = text ? (JSON.parse(text) as T) : (null as T);
	const expected = options.expect ?? [200];
	if (!expected.includes(response.status)) {
		throw new Error(
			`Unexpected HTTP ${response.status} for ${url}: ${text.slice(0, 500)}`,
		);
	}
	return { status: response.status, headers: response.headers, body };
}

function cookieHeaderFrom(response: FetchJsonResult<unknown>): string {
	const headers = response.headers as Headers & {
		getSetCookie?: () => string[];
	};
	const setCookie =
		headers.getSetCookie?.() ??
		(response.headers.get("set-cookie")
			? [response.headers.get("set-cookie") as string]
			: []);
	const cookieHeader = setCookie
		.map((cookie) => cookie.split(";")[0])
		.filter((cookie) => cookie.startsWith("qingyan_admin="))
		.join("; ");
	if (!cookieHeader) {
		throw new Error("Admin login did not return qingyan_admin cookie.");
	}
	return cookieHeader;
}

async function loginAsAdmin(config: SmokeConfig): Promise<AdminAuth> {
	const urls = buildSmokeUrls(config);
	const captcha = await fetchJson(urls.adminCaptcha);
	const captchaBody = assertRecord(captcha.body, "admin captcha");
	const challenge = assertRecord(
		captchaBody.challenge,
		"admin captcha.challenge",
	);
	const challengeId = readString(
		challenge.challengeId,
		"admin captcha challengeId",
	);
	const login = await fetchJson(urls.adminLogin, {
		method: "POST",
		body: {
			username: config.adminUsername,
			password: config.adminPassword,
			challengeId,
			captchaValue: config.adminCaptchaValue,
		},
	});
	const loginBody = assertRecord(login.body, "admin login");
	const csrf = assertRecord(loginBody.csrf, "admin login.csrf");
	return {
		cookieHeader: cookieHeaderFrom(login),
		csrfToken: readString(csrf.token, "admin csrf token"),
		origin: new URL(config.apiBase).origin,
	};
}

function adminHeaders(auth: AdminAuth): Record<string, string> {
	return {
		cookie: auth.cookieHeader,
		origin: auth.origin,
		"x-qingyan-csrf-token": auth.csrfToken,
	};
}

async function patchSmokeSettings(config: SmokeConfig, auth: AdminAuth) {
	const urls = buildSmokeUrls(config);
	const systemSettings = await fetchJson<Record<string, unknown>>(
		urls.adminSystemSettings,
		{
			headers: { cookie: auth.cookieHeader },
		},
	);
	const mail = assertRecord(systemSettings.body.mail, "system mail");
	const smtp = assertRecord(mail.smtp, "system mail.smtp");
	if (
		mail.enabled !== true ||
		typeof smtp.host !== "string" ||
		smtp.host.length === 0 ||
		typeof smtp.from !== "string" ||
		smtp.from.length === 0
	) {
		throw new Error(
			"System mail is not enabled or SMTP host/from is missing. Configure local SMTP in Admin first.",
		);
	}

	await prepareSmokeSite(config, auth);

	const siteSettings = await fetchJson<Record<string, unknown>>(
		urls.adminSiteSettings,
		{
			headers: { cookie: auth.cookieHeader },
		},
	);
	const comments = assertRecord(siteSettings.body.comments, "site comments");
	const pageRegistry = assertRecord(
		siteSettings.body.pageRegistry,
		"site pageRegistry",
	);

	await fetchJson(urls.adminSiteSettings, {
		method: "PUT",
		headers: adminHeaders(auth),
		body: buildSmokeSettingsPatch(),
	});

	return {
		previousCommentsDefaultStatus: comments.defaultStatus,
		previousCommentsCaptcha: comments.captcha,
		previousPageRegistryMode: pageRegistry.mode,
	};
}

function findSmokeSite(
	config: SmokeConfig,
	value: unknown,
): Record<string, unknown> | undefined {
	const body = assertRecord(value, "admin sites");
	const items = body.items;
	if (!Array.isArray(items)) {
		return undefined;
	}
	return items.find(
		(item) =>
			item &&
			typeof item === "object" &&
			!Array.isArray(item) &&
			(item as Record<string, unknown>).siteKey === config.siteKey,
	) as Record<string, unknown> | undefined;
}

function readSiteAllowedOrigins(site: Record<string, unknown>): string[] {
	const allowedOrigins = site.allowedOrigins;
	return Array.isArray(allowedOrigins)
		? allowedOrigins.filter(
				(origin): origin is string => typeof origin === "string",
			)
		: [];
}

async function prepareSmokeSite(config: SmokeConfig, auth: AdminAuth) {
	const urls = buildSmokeUrls(config);
	const sitesBefore = await fetchJson<Record<string, unknown>>(
		urls.adminSites,
		{
			headers: { cookie: auth.cookieHeader },
		},
	);
	const site = findSmokeSite(config, sitesBefore.body);
	if (!site) {
		await fetchJson(urls.adminSites, {
			method: "POST",
			headers: adminHeaders(auth),
			body: buildSmokeSiteCreatePayload(config),
		});
		console.log(`smoke.site.created=${config.siteKey}`);
		return;
	}

	const allowedOrigins = readSiteAllowedOrigins(site);
	if (!allowedOrigins.includes(config.pageOrigin)) {
		await fetchJson(urls.adminSite, {
			method: "PATCH",
			headers: adminHeaders(auth),
			body: {
				allowedOrigins: [...allowedOrigins, config.pageOrigin],
			},
		});
		console.log(`smoke.site.allowedOrigin.added=${config.pageOrigin}`);
		return;
	}

	console.log(`smoke.site.ready=${config.siteKey}`);
}

async function createPublicComment(input: {
	config: SmokeConfig;
	parentCommentId: string | null;
	authorName: string;
	authorEmail: string;
	contentRaw: string;
	notifyOnReply: boolean;
}) {
	const urls = buildSmokeUrls(input.config);
	const response = await fetchJson<Record<string, unknown>>(urls.comments, {
		method: "POST",
		headers: {
			referer: urls.pageUrl,
		},
		body: {
			siteKey: input.config.siteKey,
			pageTitle: input.config.pageTitle,
			parentCommentId: input.parentCommentId,
			author: {
				name: input.authorName,
				email: input.authorEmail,
			},
			content: {
				raw: input.contentRaw,
			},
			options: {
				notifyOnReply: input.notifyOnReply,
			},
			captcha: null,
		},
	});
	const body = assertRecord(response.body, "create comment");
	const comment = assertRecord(body.comment, "create comment.comment");
	return readString(comment.id, "created comment id");
}

async function approveComment(input: {
	config: SmokeConfig;
	auth: AdminAuth;
	commentId: string;
}) {
	const response = await fetchJson<Record<string, unknown>>(
		`${input.config.apiBase}/api/admin/comments/${encodeURIComponent(
			input.commentId,
		)}`,
		{
			method: "PATCH",
			headers: adminHeaders(input.auth),
			body: {
				status: "approved",
			},
		},
	);
	const body = assertRecord(response.body, "approve comment");
	const comment = assertRecord(body.comment, "approve comment.comment");
	console.log(
		"comment.approved",
		JSON.stringify({
			id: readString(comment.id, "approved comment id"),
			status: comment.status,
		}),
	);
}

async function createAdminReply(input: {
	config: SmokeConfig;
	auth: AdminAuth;
	parentCommentId: string;
	contentRaw: string;
}) {
	const response = await fetchJson<Record<string, unknown>>(
		`${input.config.apiBase}/api/admin/comments/${encodeURIComponent(
			input.parentCommentId,
		)}/reply`,
		{
			method: "POST",
			headers: adminHeaders(input.auth),
			body: {
				content: {
					raw: input.contentRaw,
				},
			},
		},
	);
	const body = assertRecord(response.body, "admin reply");
	const comment = assertRecord(body.comment, "admin reply.comment");
	return readString(comment.id, "admin reply id");
}

function extractRuns(value: unknown): Array<Record<string, unknown>> {
	const body = assertRecord(value, "task runs");
	const items = body.items;
	if (!Array.isArray(items)) {
		throw new Error("Task runs response did not include items array.");
	}
	return items.filter(
		(item): item is Record<string, unknown> =>
			Boolean(item) && typeof item === "object" && !Array.isArray(item),
	);
}

function findNotificationRunsForComment(
	runs: Array<Record<string, unknown>>,
	commentId: string,
) {
	return runs.filter((run) => {
		const payload = run.payload;
		return (
			run.category === "notification" &&
			payload &&
			typeof payload === "object" &&
			!Array.isArray(payload) &&
			(payload as Record<string, unknown>).replyCommentId === commentId
		);
	});
}

function summarizeTaskRun(run: Record<string, unknown>) {
	return {
		id: run.id,
		status: run.status,
		type: run.type,
		category: run.category,
		payload: run.payload,
	};
}

function summarizeDelivery(
	delivery: NotificationDeliveryRecord,
): SmokeDeliverySummary {
	return {
		id: delivery.id,
		taskRunId: delivery.taskRunId,
		channel: delivery.channel,
		recipientType: delivery.recipientType,
		recipientAddressSnapshot: delivery.recipientAddressSnapshot,
		templateKey: delivery.templateKey,
		status: delivery.status,
		providerMessageId: delivery.providerMessageId,
		sentAt: delivery.sentAt,
		lastError: delivery.lastError,
	};
}

async function listTaskRuns(config: SmokeConfig, auth: AdminAuth) {
	const urls = buildSmokeUrls(config);
	const response = await fetchJson(urls.adminTasksRuns, {
		headers: { cookie: auth.cookieHeader },
	});
	return extractRuns(response.body);
}

async function approveSmokePage(config: SmokeConfig, auth: AdminAuth) {
	const urls = buildSmokeUrls(config);
	const response = await fetchJson<Record<string, unknown>>(
		urls.adminPageRegistryPendingApprove,
		{
			method: "POST",
			headers: adminHeaders(auth),
			body: {
				siteKey: config.siteKey,
				pageKey: config.pagePath,
			},
			expect: [200, 409],
		},
	);
	if (response.status === 409) {
		const body = assertRecord(response.body, "page registry approve conflict");
		const error = assertRecord(
			body.error,
			"page registry approve conflict.error",
		);
		if (error.code !== "PENDING_PAGE_NOT_PENDING") {
			throw new Error(
				`Unexpected page registry approve conflict: ${JSON.stringify(error)}`,
			);
		}
		console.log(
			"smoke.page.approve.skipped=page candidate is not pending; continuing with existing registry state",
		);
		return;
	}
	const body = assertRecord(response.body, "page registry approve");
	const page = assertRecord(body.page, "page registry approve.page");
	console.log(
		"smoke.page.approved",
		JSON.stringify({
			siteKey: page.siteKey,
			pageKey: page.pageKey,
			status: page.status,
			mergedPageViews: page.mergedPageViews,
		}),
	);
}

class SmokeTargetedNotificationQueue implements TaskQueue {
	private readonly taskIds: string[];
	private readonly repository: TaskRunRepository;

	public constructor(repository: TaskRunRepository, taskIds: string[]) {
		this.repository = repository;
		this.taskIds = taskIds;
	}

	public enqueue(_task: TaskQueuePayload): Promise<TaskRunRecord> {
		throw new Error("Smoke worker queue does not support enqueue.");
	}

	public async claim(
		worker: string,
		options: { limit?: number } = {},
	): Promise<TaskRunRecord[]> {
		const claimed: TaskRunRecord[] = [];
		const limit = options.limit ?? this.taskIds.length;
		for (const taskId of this.taskIds) {
			if (claimed.length >= limit) {
				break;
			}
			const task = await this.repository.getRequired(taskId);
			if (
				task.category !== "notification" ||
				!["queued", "delayed", "retrying"].includes(task.status)
			) {
				continue;
			}
			claimed.push(
				await this.repository.markRunning(task.id, {
					workerId: worker,
					smoke: "commenter-reply-email",
				}),
			);
		}
		return claimed;
	}

	public async ack(taskId: string, result: unknown): Promise<void> {
		await this.repository.markSucceeded(taskId, result);
	}

	public async retry(
		taskId: string,
		error: unknown,
		runAfter: string,
	): Promise<void> {
		await this.repository.markRetrying(taskId, error, runAfter);
	}

	public async fail(taskId: string, error: unknown): Promise<void> {
		await this.repository.markFailed(taskId, error);
	}

	public async cancel(taskId: string, reason: unknown): Promise<void> {
		await this.repository.cancel(taskId, reason);
	}
}

async function runNotificationWorkerForTasks(
	config: SmokeConfig,
	taskIds: string[],
): Promise<WorkerRunResult> {
	const appConfig = await loadConfig(config.configPath);
	const databaseFile = path.resolve(
		process.cwd(),
		appConfig.database.sqlite.file,
	);
	const { db, sqlite } = createDatabaseClients(databaseFile);
	try {
		const settings = await new RuntimeSystemSettingsService(db).getSettings();
		if (
			!settings.mail.enabled ||
			!settings.mail.smtp.host ||
			!settings.mail.smtp.from
		) {
			throw new Error(
				"System mail from local config DB is not enabled or SMTP host/from is missing.",
			);
		}

		const repository = new TaskRunRepository(db);
		const worker = new NotificationWorker({
			queue: new SmokeTargetedNotificationQueue(repository, taskIds),
			repository,
			adapters: {
				email: new EmailNotificationChannel(
					{
						enabled: settings.mail.enabled,
						smtp: settings.mail.smtp,
					},
					createNodemailerSmtpSender(settings.mail.smtp),
				),
			},
			reputation: new EmailReputationRepository(db),
			templateContextBuilder: new NotificationTemplateContextBuilder(
				db,
				appConfig.server,
			),
		});

		const processed = await worker.runNextNotificationTask({
			limit: config.workerLimit,
		});
		const tasks = [];
		for (const taskId of taskIds) {
			const task = await repository.getRequired(taskId);
			const deliveries = await repository.listDeliveriesForTask(taskId);
			tasks.push({
				id: task.id,
				status: task.status,
				type: task.type,
				category: task.category,
				result: task.result,
				error: task.error,
				deliveries: deliveries.map(summarizeDelivery),
			});
		}
		return { databaseFile, processed, tasks };
	} finally {
		sqlite.close();
	}
}

async function maybeWaitForManualConfirmation(config: SmokeConfig) {
	if (!config.waitForManualConfirmation) {
		return;
	}
	console.log(
		"manual.confirmation.pending=请确认 Gmail 是否收到本次 QingYan 评论回复邮件，然后按 Enter 继续。",
	);
	await new Promise<void>((resolve) => {
		process.stdin.resume();
		process.stdin.once("data", () => {
			process.stdin.pause();
			resolve();
		});
	});
}

async function unsubscribeIfProvided(config: SmokeConfig) {
	if (!config.unsubscribeUrl) {
		console.log(
			"unsubscribe.pending=未提供 QINGYAN_SMOKE_UNSUBSCRIBE_URL；请从邮件中点击退订链接，或重新运行脚本并传入该 URL。",
		);
		return false;
	}
	const response = await fetchJson(config.unsubscribeUrl, {
		headers: { accept: "application/json" },
	});
	console.log(
		`unsubscribe.status=${assertRecord(response.body, "unsubscribe").status}`,
	);
	const replay = await fetch(config.unsubscribeUrl, {
		headers: { accept: "application/json" },
	});
	console.log(`unsubscribe.replay.status=${replay.status}`);
	if (replay.status !== 404) {
		throw new Error(
			`Expected unsubscribe replay to return HTTP 404, got ${replay.status}.`,
		);
	}
	return true;
}

function countRepliesForParent(
	items: unknown[],
	parentCommentId: string,
): number {
	let count = 0;
	for (const item of items) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			continue;
		}
		const record = item as Record<string, unknown>;
		const children = Array.isArray(record.children) ? record.children : [];
		if (record.id === parentCommentId) {
			count += children.length;
		}
		count += countRepliesForParent(children, parentCommentId);
	}
	return count;
}

async function assertThreadHasReplies(input: {
	config: SmokeConfig;
	parentCommentId: string;
	minReplyCount: number;
}) {
	const urls = buildSmokeUrls(input.config);
	const response = await fetchJson<Record<string, unknown>>(urls.thread, {
		headers: {
			referer: urls.pageUrl,
		},
	});
	const body = assertRecord(response.body, "thread");
	const items = body.items;
	if (!Array.isArray(items)) {
		throw new Error("Thread response did not include items array.");
	}
	const replyCount = countRepliesForParent(items, input.parentCommentId);
	console.log(`thread.replyCount=${replyCount}`);
	if (replyCount < input.minReplyCount) {
		throw new Error(
			`Expected thread to contain at least ${input.minReplyCount} replies for ${input.parentCommentId}, got ${replyCount}.`,
		);
	}
}

async function verifyPostUnsubscribeReplies(input: {
	config: SmokeConfig;
	auth: AdminAuth;
	parentCommentId: string;
	stamp: string;
}) {
	const secondReplyId = await createAdminReply({
		config: input.config,
		auth: input.auth,
		parentCommentId: input.parentCommentId,
		contentRaw: `第二条管理员回复：退订后不应创建评论者邮件。${input.stamp}`,
	});
	const thirdReplyId = await createAdminReply({
		config: input.config,
		auth: input.auth,
		parentCommentId: input.parentCommentId,
		contentRaw: `第三条管理员回复：退订后仍不应创建评论者邮件。${input.stamp}`,
	});
	const runsAfterUnsubscribe = await listTaskRuns(input.config, input.auth);
	const afterUnsubscribeRuns = [
		...findNotificationRunsForComment(runsAfterUnsubscribe, secondReplyId),
		...findNotificationRunsForComment(runsAfterUnsubscribe, thirdReplyId),
	];
	console.log(`comment.secondReply.id=${secondReplyId}`);
	console.log(`comment.thirdReply.id=${thirdReplyId}`);
	console.log(
		"notification.runs.afterUnsubscribe",
		JSON.stringify(afterUnsubscribeRuns.map(summarizeTaskRun)),
	);
	if (afterUnsubscribeRuns.length > 0) {
		throw new Error(
			"Post-unsubscribe replies created commenter notification task runs.",
		);
	}
	await assertThreadHasReplies({
		config: input.config,
		parentCommentId: input.parentCommentId,
		minReplyCount: 3,
	});
}

export async function runSmoke(config = resolveSmokeConfig()) {
	const urls = buildSmokeUrls(config);
	console.log("smoke.config", JSON.stringify(summarizeSmokeConfig(config)));
	console.log(`smoke.page=${urls.pageUrl}`);

	const auth = await loginAsAdmin(config);
	const previousSettings = await patchSmokeSettings(config, auth);
	console.log("smoke.settings.updated", JSON.stringify(previousSettings));

	const bootstrap = await fetchJson<Record<string, unknown>>(urls.bootstrap, {
		headers: {
			referer: urls.pageUrl,
		},
	});
	const bootstrapBody = assertRecord(bootstrap.body, "bootstrap");
	const features = assertRecord(bootstrapBody.features, "bootstrap.features");
	const replyEmailNotification = assertRecord(
		features.replyEmailNotification,
		"bootstrap.features.replyEmailNotification",
	);
	if (replyEmailNotification.enabled !== true) {
		throw new Error(
			`Expected features.replyEmailNotification.enabled=true, got ${String(
				features.replyEmailNotification,
			)}`,
		);
	}
	console.log("bootstrap.features.replyEmailNotification.enabled=true");
	await approveSmokePage(config, auth);

	const stamp = new Date().toISOString();
	if (config.existingParentCommentId) {
		console.log(`comment.parent.existing.id=${config.existingParentCommentId}`);
		await approveComment({
			config,
			auth,
			commentId: config.existingParentCommentId,
		});
		const unsubscribed = await unsubscribeIfProvided(config);
		if (!unsubscribed) {
			throw new Error(
				"QINGYAN_SMOKE_EXISTING_PARENT_COMMENT_ID requires QINGYAN_SMOKE_UNSUBSCRIBE_URL.",
			);
		}
		await verifyPostUnsubscribeReplies({
			config,
			auth,
			parentCommentId: config.existingParentCommentId,
			stamp,
		});
		return;
	}

	const parentCommentId = await createPublicComment({
		config,
		parentCommentId: null,
		authorName: config.authorName,
		authorEmail: config.recipientEmail,
		contentRaw: `父评论：开启回复邮件通知。${stamp}`,
		notifyOnReply: true,
	});
	console.log(`comment.parent.id=${parentCommentId}`);
	await approveComment({
		config,
		auth,
		commentId: parentCommentId,
	});

	const firstReplyId = await createAdminReply({
		config,
		auth,
		parentCommentId,
		contentRaw: `第一条管理员回复：触发评论者邮件。${stamp}`,
	});
	console.log(`comment.firstReply.id=${firstReplyId}`);

	const runsAfterFirstReply = await listTaskRuns(config, auth);
	const firstReplyRuns = findNotificationRunsForComment(
		runsAfterFirstReply,
		firstReplyId,
	);
	console.log(
		"notification.runs.afterFirstReply",
		JSON.stringify(firstReplyRuns.map(summarizeTaskRun)),
	);
	if (firstReplyRuns.length === 0) {
		throw new Error(
			"No notification task run was found for the first approved reply.",
		);
	}

	const firstTaskIds = firstReplyRuns.map((run) =>
		readString(run.id, "notification task id"),
	);
	const workerResult = await runNotificationWorkerForTasks(
		config,
		firstTaskIds,
	);
	console.log(
		"notification.worker.result",
		JSON.stringify({
			databaseFile: workerResult.databaseFile,
			processed: workerResult.processed,
			tasks: workerResult.tasks,
		}),
	);
	const firstSentDelivery = workerResult.tasks
		.flatMap((task) => task.deliveries)
		.find(
			(delivery) =>
				delivery.recipientType === "commenter" &&
				delivery.recipientAddressSnapshot.toLowerCase() ===
					config.recipientEmail.toLowerCase() &&
				delivery.status === "sent",
		);
	if (!firstSentDelivery) {
		throw new Error(
			"Notification worker did not mark a commenter delivery as sent for the first reply.",
		);
	}
	console.log(
		"notification.delivery.sent",
		JSON.stringify({
			id: firstSentDelivery.id,
			taskRunId: firstSentDelivery.taskRunId,
			recipient: firstSentDelivery.recipientAddressSnapshot,
			providerMessageId: firstSentDelivery.providerMessageId,
			sentAt: firstSentDelivery.sentAt,
		}),
	);
	await maybeWaitForManualConfirmation(config);
	const unsubscribed = await unsubscribeIfProvided(config);
	if (!unsubscribed) {
		return;
	}

	await verifyPostUnsubscribeReplies({
		config,
		auth,
		parentCommentId,
		stamp,
	});
}

if (isSmokeCliEntryPoint(__filename, process.argv[1])) {
	void runSmoke().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
}
