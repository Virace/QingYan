import {
	canonicalJson,
	hashJson,
	hashKey,
	toUtcTimestamp,
} from "../../db/values";
import { targetColumns } from "./model";
import { INLINE_METADATA, type SourceRow, type SqliteSource } from "./source";

export interface RowMapping {
	table: string;
	sourceId: string;
	targetId: string | null;
	reason: string;
}
export interface ConversionContext {
	source: SqliteSource;
	rowMappings: RowMapping[];
	differences: Array<{
		table: string;
		id: string;
		field: string;
		resolution: string;
	}>;
	retiredTaskIds: Set<string>;
	retiredRunIds: Set<string>;
	initialUserId: number;
	bootstrap: SourceRow;
	recipients: Map<string, SourceRow>;
	metricIdentities: Map<string, { id: string; dimension: string }>;
	visitorIdentities: Map<string, string>;
	eventSequences: Map<string, Set<number>>;
}

export function createContext(
	source: SqliteSource,
	bootstrapOverrides?: {
		username?: string;
		passwordHash?: string;
		consolePath?: string;
	},
): ConversionContext {
	const bootstrap = { ...source.rows("admin_bootstrap_state")[0] };
	if (bootstrapOverrides?.username)
		bootstrap.username = bootstrapOverrides.username;
	if (bootstrapOverrides?.passwordHash)
		bootstrap.password_hash = bootstrapOverrides.passwordHash;
	if (bootstrapOverrides?.consolePath)
		bootstrap.console_path = bootstrapOverrides.consolePath;
	const user = source
		.rows("admin_users")
		.find((row) => row.username === bootstrap.username);
	if (!user)
		throw new Error("BOOTSTRAP_EFFECTIVE_USER_REQUIRES_RECONCILIATION");
	const retiredTaskIds = new Set(
		source
			.rows("scheduled_tasks")
			.filter((row) => row.type === "backup")
			.map((row) => String(row.id)),
	);
	const retiredRunIds = new Set(
		source
			.rows("task_runs")
			.filter(
				(row) =>
					row.type === "backup" ||
					retiredTaskIds.has(String(row.scheduled_task_id)),
			)
			.map((row) => String(row.id)),
	);
	return {
		source,
		rowMappings: [],
		differences:
			bootstrap.password_rotated_at !== user.password_rotated_at
				? [
						{
							table: "admin_bootstrap_state",
							id: String(bootstrap.id),
							field: "password_rotated_at",
							resolution:
								"historical bootstrap rotation archived; account rotation timestamp preserved as read by 0.2.5 account service",
						},
					]
				: [],
		retiredTaskIds,
		retiredRunIds,
		initialUserId: Number(user.id),
		bootstrap,
		recipients: new Map(
			source
				.rows("site_notification_recipients")
				.map((row) => [String(row.id), row]),
		),
		metricIdentities: new Map(),
		visitorIdentities: new Map(),
		eventSequences: new Map(),
	};
}

function recordArchive(
	context: ConversionContext,
	table: string,
	row: SourceRow,
	reason = "retired-backup:source.sqlite",
) {
	context.rowMappings.push({
		table,
		sourceId: String(row.id),
		targetId: null,
		reason,
	});
	return null;
}

/** 仅转换 failureNotification 的目标身份，不改写内容中碰巧相同的字符串。 */
export function convertTaskReferences(
	value: unknown,
	context: ConversionContext,
	location: string,
): unknown {
	if (Array.isArray(value))
		return value.map((entry) =>
			convertTaskReferences(entry, context, location),
		);
	if (!value || typeof value !== "object") return value;
	const object = value as Record<string, unknown>;
	return Object.fromEntries(
		Object.entries(object).map(([key, nested]) => {
			if (
				key !== "failureNotification" ||
				!nested ||
				typeof nested !== "object"
			)
				return [key, convertTaskReferences(nested, context, location)];
			const policy = nested as Record<string, unknown>;
			if (!Array.isArray(policy.recipientIds)) return [key, nested];
			const recipientIds = policy.recipientIds.flatMap((id) => {
				if (typeof id !== "string")
					throw new Error(`TASK_RECIPIENT_INVALID:${location}`);
				if (/^user:[1-9]\d*$/.test(id)) return [id];
				const recipient = context.recipients.get(id);
				if (!recipient) {
					if (policy.enabled === true)
						throw new Error(`TASK_RECIPIENT_UNRESOLVED:${location}`);
					context.rowMappings.push({
						table: location,
						sourceId: id,
						targetId: null,
						reason: "disabled-unresolved-recipient:source.sqlite",
					});
					return [];
				}
				if (!recipient.enabled) {
					context.rowMappings.push({
						table: location,
						sourceId: id,
						targetId: null,
						reason: "legacy-disabled-recipient:source.sqlite",
					});
					return [];
				}
				const targetId = `user:${recipient.user_id}`;
				context.rowMappings.push({
					table: location,
					sourceId: id,
					targetId,
					reason: "effective-task-failure-recipient",
				});
				return [targetId];
			});
			return [key, { ...policy, recipientIds: [...new Set(recipientIds)] }];
		}),
	);
}

export function transformRow(
	table: string,
	original: SourceRow,
	context: ConversionContext,
): SourceRow | null {
	const row = { ...original };
	if (table === "captcha_sessions")
		return recordArchive(
			context,
			table,
			row,
			"captcha-session-expired:source.sqlite",
		);
	if (table === "scheduled_tasks" && context.retiredTaskIds.has(String(row.id)))
		return recordArchive(context, table, row);
	if (table === "task_runs" && context.retiredRunIds.has(String(row.id)))
		return recordArchive(context, table, row);
	if (
		["task_event_logs", "notification_deliveries"].includes(table) &&
		context.retiredRunIds.has(String(row.task_run_id))
	)
		return recordArchive(context, table, row);
	if (table === "scheduled_task_deleted_snapshots") {
		const snapshot = JSON.parse(String(row.snapshot_json)) as Record<
			string,
			unknown
		>;
		if (snapshot.type === "backup") return recordArchive(context, table, row);
		const converted = convertTaskReferences(
			snapshot,
			context,
			`${table}:${row.id}`,
		) as Record<string, unknown>;
		converted.claimWorkerId = null;
		converted.claimExpiresAt = null;
		row.snapshot_json = JSON.stringify(converted);
	}
	if (table === "admin_users" && Number(row.id) === context.initialUserId) {
		if (row.password_hash !== context.bootstrap.password_hash)
			context.differences.push({
				table,
				id: String(row.id),
				field: "password_hash",
				resolution: "0.2.5 effective bootstrap credentials",
			});
		row.password_hash = context.bootstrap.password_hash;
	}
	if (table === "admin_bootstrap_state") {
		row.initial_admin_user_id = context.initialUserId;
		row.console_path = context.bootstrap.console_path;
	}
	if (
		[
			"site_page_registry",
			"page_threads",
			"pending_page_candidates",
			"pending_page_view_sessions",
		].includes(table)
	)
		row.page_key_hash = hashKey(String(row.page_key));
	if (
		table === "admin_user_notification_preferences" &&
		!row.channel_config_ref
	) {
		if (row.channel !== "email")
			throw new Error("NOTIFICATION_PREFERENCE_CHANNEL_UNRESOLVED");
		row.channel_config_ref = "email:default";
	}
	if (table === "scheduled_tasks") {
		row.claim_worker_id = null;
		row.claim_expires_at = null;
	}
	if (["scheduled_tasks", "task_runs"].includes(table)) {
		for (const field of [
			"payload_json",
			"policy_json",
			"trigger_json",
			"action_config_snapshot_json",
			"input_json",
			"trigger_snapshot_json",
		]) {
			if (row[field] != null)
				row[field] = JSON.stringify(
					convertTaskReferences(
						JSON.parse(String(row[field])),
						context,
						`${table}:${row.id}`,
					),
				);
		}
	}
	if (table === "task_runs") {
		row.claim_token = null;
		if (row.status === "running") {
			const deliveries = context.source
				.rows("notification_deliveries")
				.filter((delivery) => delivery.task_run_id === row.id);
			if (row.category === "notification" || deliveries.length)
				throw new Error("ACTIVE_NOTIFICATION_REQUIRES_SOURCE_RECONCILIATION");
			row.status = "queued";
			row.worker_id = null;
			context.rowMappings.push({
				table,
				sourceId: String(row.id),
				targetId: String(row.id),
				reason: "stopped-worker-lease-requeued; attempts-and-history-preserved",
			});
		}
	}
	if (table === "task_event_logs") {
		const used =
			context.eventSequences.get(String(row.task_run_id)) ?? new Set<number>();
		let sequence = Number(row.sequence);
		while (used.has(sequence)) sequence++;
		if (sequence !== Number(row.sequence))
			context.rowMappings.push({
				table,
				sourceId: String(row.id),
				targetId: String(row.id),
				reason: `event-sequence:${row.sequence}->${sequence}`,
			});
		row.sequence = sequence;
		used.add(sequence);
		context.eventSequences.set(String(row.task_run_id), used);
	}
	if (table === "task_metric_rollups") {
		const dimension = JSON.parse(String(row.dimension_json));
		row.dimension_hash = hashJson(dimension);
		row.dimension_json = canonicalJson(dimension);
		if (row.site_key === "__global__" && row.site_id === null)
			row.site_key = null;
		const identity = canonicalJson([
			row.site_key,
			row.metric_key,
			toUtcTimestamp(String(row.bucket_start_at)),
			row.bucket_size_sec,
			Buffer.from(row.dimension_hash).toString("hex"),
		]);
		const existing = context.metricIdentities.get(identity);
		if (existing && existing.dimension !== row.dimension_json)
			throw new Error("METRIC_DIMENSION_HASH_COLLISION");
		if (existing) {
			context.rowMappings.push({
				table,
				sourceId: String(row.id),
				targetId: existing.id,
				reason: "canonical-metric-identity-merge",
			});
			row.id = existing.id;
		} else
			context.metricIdentities.set(identity, {
				id: String(row.id),
				dimension: String(row.dimension_json),
			});
	}
	if (table === "visitor_request_metadata") {
		const identity = canonicalJson([
			row.visitor_id,
			row.ip_hash,
			row.user_agent_hash,
		]);
		const existing = context.visitorIdentities.get(identity);
		if (existing) {
			context.rowMappings.push({
				table,
				sourceId: String(row.id),
				targetId: existing,
				reason: "nullable-visitor-metadata-identity-merge",
			});
			row.id = existing;
		} else context.visitorIdentities.set(identity, String(row.id));
	}
	if (table === "ip_region_database_state") {
		const latest = context.source.database
			.prepare(
				"SELECT * FROM ip_region_update_runs WHERE ip_version = ? ORDER BY julianday(created_at) DESC, id DESC LIMIT 1",
			)
			.get(row.ip_version as string) as SourceRow | undefined;
		row.last_checked_at = latest?.updated_at ?? latest?.created_at ?? null;
		row.last_check_status = latest?.status ?? null;
		row.last_check_reason = null;
		row.last_check_error = latest?.error_message ?? null;
	}
	return projectTargetRow(table, row);
}

export function projectTargetRow(table: string, source: SourceRow): SourceRow {
	return Object.fromEntries(
		targetColumns(table).map((column) => {
			let value = source[column.name] ?? null;
			const type = column.getSQLType();
			if (value !== null && type.startsWith("timestamptz"))
				value = toUtcTimestamp(String(value));
			if (value !== null && type === "boolean") {
				if (value !== 0 && value !== 1)
					throw new Error(`SQLITE_BOOLEAN_INVALID:${table}.${column.name}`);
				// SourceRow 使用 SQLite 原值；pg boolean 参数接受文本。
				value = value === 1 ? "true" : "false";
			}
			if (value !== null && type === "jsonb") {
				JSON.parse(String(value));
			}
			if (
				typeof value === "bigint" ||
				(typeof value === "number" && type !== "double precision")
			) {
				if (!Number.isSafeInteger(Number(value)))
					throw new Error(
						`SQLITE_INTEGER_OUT_OF_RANGE:${table}.${column.name}`,
					);
			}
			return [column.name, value];
		}),
	);
}

export function metadataFallback(context: ConversionContext): SourceRow[] {
	const rows = new Map(
		context.source
			.rows("comment_request_metadata")
			.map((row) => [String(row.comment_id), { ...row }]),
	);
	for (const comment of context.source.rows("comments")) {
		let metadata = rows.get(String(comment.id));
		for (const [inline, field] of Object.entries(INLINE_METADATA)) {
			const value = comment[inline];
			if (value === null || value === undefined) continue;
			if (!metadata) {
				metadata = {
					comment_id: comment.id,
					created_at: comment.created_at,
					updated_at: comment.updated_at,
				};
				rows.set(String(comment.id), metadata);
			}
			if (metadata[field] === null || metadata[field] === undefined)
				metadata[field] = value;
			else if (metadata[field] !== value)
				context.differences.push({
					table: "comments",
					id: String(comment.id),
					field: inline,
					resolution:
						"effective independent metadata; original inline value archived",
				});
		}
	}
	return [...rows.values()].map((row) =>
		projectTargetRow("comment_request_metadata", row),
	);
}

export function ipDatabaseStates(context: ConversionContext): SourceRow[] {
	const states = context.source.rows("ip_region_database_state");
	const versions = new Set(states.map((row) => row.ip_version));
	const highWater = Number(
		context.source.database
			.prepare(
				"SELECT seq FROM sqlite_sequence WHERE name='ip_region_database_state'",
			)
			.get()?.seq ?? 0,
	);
	let nextId =
		Math.max(highWater, ...states.map((row) => Number(row.id)), 0) + 1;
	for (const version of context.source.database
		.prepare(
			"SELECT DISTINCT ip_version FROM ip_region_update_runs ORDER BY ip_version",
		)
		.all()) {
		if (versions.has(version.ip_version as string)) continue;
		const latest = context.source.database
			.prepare(
				"SELECT * FROM ip_region_update_runs WHERE ip_version=? ORDER BY julianday(created_at) DESC,id DESC LIMIT 1",
			)
			.get(version.ip_version as string) as SourceRow;
		const row: SourceRow = {
			id: nextId++,
			ip_version: version.ip_version as string,
			file_path: null,
			file_hash: null,
			source_url: null,
			cache_policy: null,
			activated_at: null,
			updated_at: latest.updated_at ?? latest.created_at,
		};
		states.push(row);
		context.rowMappings.push({
			table: "ip_region_update_runs",
			sourceId: String(latest.id),
			targetId: String(row.id),
			reason: "latest-check-to-ip-region-state-without-active-database",
		});
	}
	return states;
}
