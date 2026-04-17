import type { AccessLogRecord, AppLogRecord, LogLevel } from "./types";

function formatTextTimestamp(isoTimestamp: string): string {
	return isoTimestamp.replace("T", " ").replace("Z", "");
}

function formatLevel(level: LogLevel): string {
	return level.toUpperCase();
}

function joinTokens(tokens: Array<string | undefined>): string {
	return tokens.filter((token): token is string => Boolean(token)).join(" ");
}

export function formatAccessTextLine(record: AccessLogRecord): string {
	return joinTokens([
		formatTextTimestamp(record.ts ?? new Date().toISOString()),
		`[${formatLevel(record.level)}]`,
		record.channel,
		record.event,
		`rid=${record.requestId}`,
		`method=${record.method}`,
		`path=${record.path}`,
		`status=${record.statusCode}`,
		`dur=${record.durationMs}ms`,
		record.ip ? `ip=${record.ip}` : undefined,
		record.siteKey ? `site=${record.siteKey}` : undefined,
		record.pageKey ? `page=${record.pageKey}` : undefined,
		record.errorCode ? `errCode=${record.errorCode}` : undefined,
		record.userAgent ? `ua=${JSON.stringify(record.userAgent)}` : undefined,
	]);
}

export function formatAccessJsonlLine(record: AccessLogRecord): string {
	return JSON.stringify({
		ts: record.ts ?? new Date().toISOString(),
		level: record.level,
		channel: record.channel,
		event: record.event,
		requestId: record.requestId,
		method: record.method,
		path: record.path,
		statusCode: record.statusCode,
		durationMs: record.durationMs,
		ip: record.ip,
		userAgent: record.userAgent,
		siteKey: record.siteKey,
		pageKey: record.pageKey,
		errorCode: record.errorCode,
	});
}

export function formatAppTextLine(record: AppLogRecord): string {
	return joinTokens([
		formatTextTimestamp(record.ts ?? new Date().toISOString()),
		`[${formatLevel(record.level)}]`,
		record.channel,
		record.event,
		record.message,
		record.requestId ? `rid=${record.requestId}` : undefined,
		record.siteKey ? `site=${record.siteKey}` : undefined,
		record.pageKey ? `page=${record.pageKey}` : undefined,
		record.actorType ? `actorType=${record.actorType}` : undefined,
		record.actorId ? `actorId=${record.actorId}` : undefined,
		record.targetType ? `targetType=${record.targetType}` : undefined,
		record.targetId ? `targetId=${record.targetId}` : undefined,
	]);
}

export function formatAppJsonlLine(record: AppLogRecord): string {
	return JSON.stringify({
		ts: record.ts ?? new Date().toISOString(),
		level: record.level,
		channel: record.channel,
		event: record.event,
		requestId: record.requestId,
		siteKey: record.siteKey,
		pageKey: record.pageKey,
		actorType: record.actorType,
		actorId: record.actorId,
		targetType: record.targetType,
		targetId: record.targetId,
		message: record.message,
		data: record.data,
	});
}
