import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Pool } from "pg";
import { canonicalJson, toUtcTimestamp } from "../../db/values";
import { IMPORT_ORDER, primaryKeys, targetColumns } from "./model";
import {
	INLINE_METADATA,
	quoteIdentifier,
	type SourceRow,
	type SqliteSource,
} from "./source";
import type { ConversionContext } from "./transform";

function normalized(value: unknown, type: string): unknown {
	if (value === null || value === undefined) return null;
	if (type === "jsonb")
		return typeof value === "string" ? JSON.parse(value) : value;
	if (type.startsWith("timestamptz")) return toUtcTimestamp(String(value));
	if (type === "boolean")
		return value === true || value === 1 || value === "true";
	if (["bigint", "integer", "double precision"].includes(type))
		return Number(value);
	return value;
}

function assertSame(left: unknown, right: unknown, location: string) {
	if (!isDeepStrictEqual(left, right))
		throw new Error(`CONVERSION_VERIFICATION_FAILED:${location}`);
}

function keyOf(row: SourceRow, keys: string[]) {
	return JSON.stringify(keys.map((key) => String(row[key])));
}

/** 独立再读 SQLite 与 PostgreSQL：直接字段逐值核对，转换字段按源事实单独证明。 */
export async function verifyConvertedDatabase(
	pool: Pool,
	source: SqliteSource,
	context: ConversionContext,
) {
	const startedAt = performance.now();
	const tables: Array<{
		table: string;
		sourceRows: number;
		targetRows: number;
		comparedFields: number;
		digest: string;
	}> = [];
	const recipientUsers = new Map(
		source
			.rows("site_notification_recipients")
			.map((row) => [String(row.id), row]),
	);
	function referenceExpectation(value: unknown): unknown {
		if (Array.isArray(value)) return value.map(referenceExpectation);
		if (!value || typeof value !== "object") return value;
		const object = value as Record<string, unknown>;
		const output: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(object)) {
			if (key === "failureNotification" && child && typeof child === "object") {
				const policy = child as Record<string, unknown>;
				if (Array.isArray(policy.recipientIds)) {
					const ids = policy.recipientIds.flatMap((id) => {
						if (/^user:[1-9]\d*$/.test(String(id))) return [id];
						const recipient = recipientUsers.get(String(id));
						return recipient?.enabled ? [`user:${recipient.user_id}`] : [];
					});
					output[key] = { ...policy, recipientIds: [...new Set(ids)] };
					continue;
				}
			}
			output[key] = referenceExpectation(child);
		}
		return output;
	}
	for (const table of IMPORT_ORDER) {
		const targetCount = Number(
			(
				await pool.query(
					`SELECT count(*) AS count FROM ${quoteIdentifier(table)}`,
				)
			).rows[0].count,
		);
		const keys = primaryKeys(table);
		const columns = targetColumns(table);
		const hash = createHash("sha256");
		let comparedFields = 0;
		let expectedRows = 0;
		const seenKeys = new Set<string>();
		for (const sourcePage of source.pages(table)) {
			const identities = sourcePage.map((original) => {
				const identity = { ...original };
				const mapping = context.rowMappings.find(
					(entry) =>
						entry.table === table &&
						entry.sourceId === String(original.id) &&
						[
							"canonical-metric-identity-merge",
							"nullable-visitor-metadata-identity-merge",
						].includes(entry.reason),
				);
				if (mapping) identity.id = mapping.targetId;
				if (
					table === "admin_user_notification_preferences" &&
					!identity.channel_config_ref
				)
					identity.channel_config_ref = "email:default";
				return identity;
			});
			const parameters = identities.flatMap((identity) =>
				keys.map((key) => identity[key]),
			);
			const predicate = identities
				.map(
					(_, index) =>
						`(${keys.map((key, keyIndex) => `${quoteIdentifier(key)} = $${index * keys.length + keyIndex + 1}`).join(" AND ")})`,
				)
				.join(" OR ");
			const targets = (
				await pool.query(
					`SELECT * FROM ${quoteIdentifier(table)} WHERE ${predicate}`,
					parameters,
				)
			).rows as SourceRow[];
			const targetByKey = new Map(
				targets.map((row) => [keyOf(row, keys), row]),
			);
			for (const original of sourcePage) {
				const mapping = context.rowMappings.find(
					(entry) =>
						entry.table === table &&
						entry.sourceId === String(original.id) &&
						[
							"retired-backup:source.sqlite",
							"captcha-session-expired:source.sqlite",
							"canonical-metric-identity-merge",
							"nullable-visitor-metadata-identity-merge",
						].includes(entry.reason),
				);
				if (mapping?.targetId === null) continue;
				const identity = { ...original };
				if (mapping) identity.id = mapping.targetId;
				if (
					table === "admin_user_notification_preferences" &&
					!identity.channel_config_ref
				)
					identity.channel_config_ref = "email:default";
				const key = keyOf(identity, keys);
				if (!seenKeys.has(key)) {
					expectedRows++;
					seenKeys.add(key);
				}
				const target = targetByKey.get(key);
				if (!target) throw new Error(`CONVERSION_ROW_MISSING:${table}`);
				for (const column of columns) {
					const field = column.name;
					let expected: unknown = original[field];
					if (table === "admin_bootstrap_state") {
						if (field === "initial_admin_user_id")
							expected = context.initialUserId;
						if (field === "console_path")
							expected = context.bootstrap.console_path;
					}
					if (
						table === "admin_users" &&
						Number(original.id) === context.initialUserId &&
						field === "password_hash"
					)
						expected = context.bootstrap.password_hash;
					if (field === "page_key_hash")
						expected = createHash("sha256")
							.update(String(original.page_key))
							.digest();
					if (table === "task_runs" && field === "claim_token") expected = null;
					if (
						table === "task_runs" &&
						original.status === "running" &&
						field === "status"
					)
						expected = "queued";
					if (
						table === "task_runs" &&
						original.status === "running" &&
						field === "worker_id"
					)
						expected = null;
					if (
						table === "scheduled_tasks" &&
						["claim_worker_id", "claim_expires_at"].includes(field)
					)
						expected = null;
					if (
						table === "admin_user_notification_preferences" &&
						field === "channel_config_ref"
					)
						expected = original[field] || "email:default";
					if (
						["scheduled_tasks", "task_runs"].includes(table) &&
						[
							"payload_json",
							"policy_json",
							"trigger_json",
							"action_config_snapshot_json",
							"input_json",
							"trigger_snapshot_json",
						].includes(field) &&
						original[field] !== null &&
						original[field] !== undefined
					)
						expected = JSON.stringify(
							referenceExpectation(JSON.parse(String(original[field]))),
						);
					if (
						table === "scheduled_task_deleted_snapshots" &&
						field === "snapshot_json"
					) {
						const snapshot = referenceExpectation(
							JSON.parse(String(original[field])),
						) as Record<string, unknown>;
						expected = JSON.stringify({
							...snapshot,
							claimWorkerId: null,
							claimExpiresAt: null,
						});
					}
					if (table === "task_event_logs" && field === "sequence") {
						const eventMapping = context.rowMappings.find(
							(entry) =>
								entry.table === table &&
								entry.sourceId === String(original.id) &&
								entry.reason.startsWith("event-sequence:"),
						);
						if (eventMapping)
							expected = Number(eventMapping.reason.split("->")[1]);
					}
					if (
						table === "comment_request_metadata" &&
						Object.values(INLINE_METADATA).includes(field) &&
						expected === null
					) {
						const comment = source.database
							.prepare("SELECT * FROM comments WHERE id = ?")
							.get(String(original.comment_id)) as SourceRow;
						const inline = Object.entries(INLINE_METADATA).find(
							([, targetField]) => targetField === field,
						)?.[0];
						if (inline) expected = comment[inline];
					}
					if (
						table === "ip_region_database_state" &&
						field.startsWith("last_check")
					) {
						const latest = source.database
							.prepare(
								"SELECT * FROM ip_region_update_runs WHERE ip_version = ? ORDER BY julianday(created_at) DESC, id DESC LIMIT 1",
							)
							.get(String(original.ip_version));
						expected =
							field === "last_checked_at"
								? (latest?.updated_at ?? latest?.created_at ?? null)
								: field === "last_check_status"
									? (latest?.status ?? null)
									: field === "last_check_error"
										? (latest?.error_message ?? null)
										: null;
					}
					if (table === "task_metric_rollups") {
						if (
							[
								"id",
								"value",
								"sample_count",
								"created_at",
								"updated_at",
							].includes(field)
						)
							continue;
						if (
							field === "site_key" &&
							original.site_key === "__global__" &&
							original.site_id === null
						)
							expected = null;
						if (field === "dimension_hash")
							expected = createHash("sha256")
								.update(
									canonicalJson(JSON.parse(String(original.dimension_json))),
								)
								.digest();
					}
					if (
						table === "visitor_request_metadata" &&
						context.rowMappings.some(
							(entry) =>
								entry.table === table &&
								entry.reason === "nullable-visitor-metadata-identity-merge" &&
								(entry.targetId === String(original.id) ||
									entry.sourceId === String(original.id)),
						)
					)
						continue;
					const actual = target[field];
					if (expected instanceof Uint8Array)
						assertSame(
							Buffer.from(expected),
							Buffer.from(actual as Uint8Array),
							`${table}.${field}`,
						);
					else
						assertSame(
							normalized(expected, column.getSQLType()),
							normalized(actual, column.getSQLType()),
							`${table}.${field}`,
						);
					hash.update(
						canonicalJson([
							key,
							field,
							normalized(actual, column.getSQLType()),
						]),
					);
					comparedFields++;
				}
			}
		}
		if (table === "comment_request_metadata") {
			const inlineOnly = source.database
				.prepare(
					`SELECT c.* FROM comments c LEFT JOIN comment_request_metadata m ON m.comment_id = c.id WHERE m.comment_id IS NULL AND (${Object.keys(
						INLINE_METADATA,
					)
						.map((column) => `c.${quoteIdentifier(column)} IS NOT NULL`)
						.join(" OR ")})`,
				)
				.all() as SourceRow[];
			expectedRows += inlineOnly.length;
			for (const comment of inlineOnly) {
				const metadata = (
					await pool.query(
						"SELECT * FROM comment_request_metadata WHERE comment_id=$1",
						[comment.id],
					)
				).rows[0];
				if (!metadata) throw new Error("COMMENT_INLINE_METADATA_MISSING");
				for (const column of columns) {
					const inline = Object.entries(INLINE_METADATA).find(
						([, field]) => field === column.name,
					)?.[0];
					const expected =
						column.name === "comment_id"
							? comment.id
							: inline
								? comment[inline]
								: comment[column.name];
					assertSame(
						normalized(expected, column.getSQLType()),
						normalized(metadata[column.name], column.getSQLType()),
						`comment-inline-fallback.${column.name}`,
					);
					hash.update(
						canonicalJson([
							String(comment.id),
							column.name,
							normalized(metadata[column.name], column.getSQLType()),
						]),
					);
					comparedFields++;
				}
			}
		}
		if (table === "ip_region_database_state") {
			const missingVersions = source.database
				.prepare(
					"SELECT DISTINCT ip_version FROM ip_region_update_runs WHERE ip_version NOT IN (SELECT ip_version FROM ip_region_database_state)",
				)
				.all();
			for (const version of missingVersions) {
				const latest = source.database
					.prepare(
						"SELECT * FROM ip_region_update_runs WHERE ip_version=? ORDER BY julianday(created_at) DESC,id DESC LIMIT 1",
					)
					.get(version.ip_version as string);
				const target = (
					await pool.query(
						"SELECT * FROM ip_region_database_state WHERE ip_version=$1",
						[version.ip_version],
					)
				).rows[0];
				if (!target)
					throw new Error("IP_RECENT_CHECK_WITHOUT_ACTIVE_DB_MISSING");
				assertSame(
					[target.file_path, target.file_hash, target.activated_at],
					[null, null, null],
					"ip-state-no-fabricated-activation",
				);
				assertSame(
					[
						normalized(target.last_checked_at, "timestamptz"),
						target.last_check_status,
						target.last_check_error,
					],
					[
						normalized(latest?.updated_at ?? latest?.created_at, "timestamptz"),
						latest?.status,
						latest?.error_message,
					],
					"ip-state-latest-check-only",
				);
				expectedRows++;
			}
		}
		const ledgerExtra =
			table === "__qingyan_upgrades"
				? Number(
						(
							await pool.query(
								"SELECT count(*) AS count FROM __qingyan_upgrades WHERE name IN ('sqlite-to-postgresql-started','sqlite-to-postgresql-completed')",
							)
						).rows[0].count,
					)
				: 0;
		assertSame(expectedRows + ledgerExtra, targetCount, `${table}.row-count`);
		tables.push({
			table,
			sourceRows: Number(
				source.database
					.prepare(`SELECT count(*) AS count FROM ${quoteIdentifier(table)}`)
					.get()?.count,
			),
			targetRows: targetCount,
			comparedFields,
			digest: hash.digest("hex"),
		});
	}
	// 指标每个目标桶的累计值、计数和时间范围由源行分组重新计算。
	const metricGroups = new Map<
		string,
		{ value: number; samples: number; first: string; last: string }
	>();
	for (const page of source.pages("task_metric_rollups"))
		for (const row of page) {
			const mapping = context.rowMappings.find(
				(entry) =>
					entry.table === "task_metric_rollups" &&
					entry.sourceId === String(row.id),
			);
			const id = mapping?.targetId ?? String(row.id);
			const first = toUtcTimestamp(String(row.created_at));
			const last = toUtcTimestamp(String(row.updated_at));
			const group = metricGroups.get(id);
			if (group) {
				group.value += Number(row.value);
				group.samples += Number(row.sample_count);
				group.first = group.first < first ? group.first : first;
				group.last = group.last > last ? group.last : last;
			} else
				metricGroups.set(id, {
					value: Number(row.value),
					samples: Number(row.sample_count),
					first,
					last,
				});
		}
	for (const row of (
		await pool.query(
			"SELECT id,value,sample_count,created_at,updated_at FROM task_metric_rollups",
		)
	).rows) {
		const group = metricGroups.get(row.id);
		if (
			!group ||
			Math.abs(group.value - Number(row.value)) >
				1e-9 * Math.max(1, Math.abs(group.value))
		)
			throw new Error("METRIC_VALUE_MISMATCH");
		assertSame(
			[group.samples, group.first, group.last],
			[
				Number(row.sample_count),
				toUtcTimestamp(row.created_at),
				toUtcTimestamp(row.updated_at),
			],
			"metric-counts-and-range",
		);
	}
	const sourceSeen = Number(
		source.database
			.prepare(
				"SELECT coalesce(sum(seen_count),0) AS total FROM visitor_request_metadata",
			)
			.get()?.total,
	);
	const targetSeen = Number(
		(
			await pool.query(
				"SELECT coalesce(sum(seen_count),0) AS total FROM visitor_request_metadata",
			)
		).rows[0].total,
	);
	assertSame(sourceSeen, targetSeen, "visitor-seen-count-total");
	const duplicateVisitorGroups = source.database
		.prepare(
			"SELECT visitor_id,ip_hash,user_agent_hash FROM visitor_request_metadata GROUP BY visitor_id,ip_hash,user_agent_hash HAVING count(*) > 1",
		)
		.all();
	for (const identity of duplicateVisitorGroups) {
		const rows = source.database
			.prepare(
				"SELECT * FROM visitor_request_metadata WHERE visitor_id=? AND ip_hash IS ? AND user_agent_hash IS ? ORDER BY rowid",
			)
			.all(
				identity.visitor_id as number,
				identity.ip_hash as string | null,
				identity.user_agent_hash as string | null,
			) as SourceRow[];
		const latest = [...rows]
			.sort(
				(left, right) =>
					String(normalized(left.last_seen_at, "timestamptz")).localeCompare(
						String(normalized(right.last_seen_at, "timestamptz")),
					) || Number(left.id) - Number(right.id),
			)
			.at(-1) as SourceRow;
		const expected: SourceRow = { ...latest, id: rows[0].id };
		expected.seen_count = rows.reduce(
			(total, row) => total + Number(row.seen_count),
			0,
		);
		for (const field of ["first_seen_at", "created_at"])
			expected[field] = rows
				.map((row) => toUtcTimestamp(String(row[field])))
				.sort()[0];
		for (const field of ["last_seen_at", "updated_at"])
			expected[field] = rows
				.map((row) => toUtcTimestamp(String(row[field])))
				.sort()
				.at(-1) as string;
		const target = (
			await pool.query("SELECT * FROM visitor_request_metadata WHERE id=$1", [
				expected.id,
			])
		).rows[0];
		if (!target) throw new Error("VISITOR_METADATA_MERGE_TARGET_MISSING");
		for (const column of targetColumns("visitor_request_metadata"))
			assertSame(
				normalized(expected[column.name], column.getSQLType()),
				normalized(target[column.name], column.getSQLType()),
				`visitor-metadata-merge.${column.name}`,
			);
	}
	const invalid = await pool.query(
		"SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND NOT convalidated",
	);
	assertSame(invalid.rowCount, 0, "all-database-constraints-validated");
	return {
		verified: true,
		tables,
		comparedFields: tables.reduce(
			(sum, table) => sum + table.comparedFields,
			0,
		),
		visitorSeenCount: sourceSeen,
		metricGroups: metricGroups.size,
		elapsedMs: Math.round(performance.now() - startedAt),
	};
}
