export const logLevels = ["error", "warn", "info", "debug"] as const;

export type LogLevel = (typeof logLevels)[number];
export type LogChannel = "access" | "app";

export const logLevelPriority: Record<LogLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
};

export type AccessEventName =
	| "request.completed"
	| "request.failed"
	| "request.blocked.blacklist"
	| "request.rate_limited"
	| "request.validation_failed";

export type AppEventName =
	| "service.started"
	| "service.stopped"
	| "service.crashed"
	| "ops.service_restart.requested"
	| "ops.service_restart.rejected"
	| "admin.login.succeeded"
	| "admin.login.failed"
	| "admin.login.blocked"
	| "security.blacklist.hit"
	| "security.blacklist.added"
	| "security.blacklist.deleted"
	| "security.allowlist.added"
	| "captcha.required"
	| "captcha.verified"
	| "captcha.failed"
	| "comments.created"
	| "comments.updated"
	| "comments.status.changed"
	| "comments.deleted"
	| "pages.updated"
	| "sites.created"
	| "sites.updated"
	| "users.updated"
	| "settings.updated"
	| "system.logging.updated"
	| "notification.chain_test.started"
	| "notification.chain_test.completed"
	| "notification.chain_test.failed"
	| "notification.email.sent"
	| "notification.email.failed";

export interface LogRuntimeSettings {
	level: LogLevel;
	retentionDays: number;
}

export interface AccessLogRecord {
	ts?: string;
	level: LogLevel;
	channel: "access";
	event: AccessEventName;
	requestId: string;
	method: string;
	path: string;
	statusCode: number;
	durationMs: number;
	ip?: string;
	userAgent?: string;
	siteKey?: string;
	pageKey?: string;
	errorCode?: string;
}

export interface AppLogRecord {
	ts?: string;
	level: LogLevel;
	channel: "app";
	event: AppEventName;
	requestId?: string;
	siteKey?: string;
	pageKey?: string;
	actorType?: string;
	actorId?: string;
	targetType?: string;
	targetId?: string;
	message: string;
	data?: Record<string, unknown>;
}
