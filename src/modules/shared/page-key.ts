import { sql } from "drizzle-orm";

import type { DatabaseExecutor } from "../../db/client";
import { hashKey } from "../../db/values";
import { AppError } from "./errors";

export async function lockPageKey(
	db: DatabaseExecutor,
	scope: number | string,
	pageKey: string,
) {
	await db.execute(
		sql`SELECT pg_advisory_xact_lock(hashtextextended(${`page:${scope}:${hashKey(pageKey).toString("hex")}`}, 0))`,
	);
}

export async function assertPageKeyAvailable(
	db: DatabaseExecutor,
	table:
		| "page_threads"
		| "site_page_registry"
		| "pending_page_candidates"
		| "pending_page_view_sessions",
	scope: number | string,
	pageKey: string,
) {
	const scopeColumn = typeof scope === "number" ? "site_id" : "site_key";
	const rows = await db.execute<{ page_key: string }>(
		sql`SELECT page_key FROM ${sql.identifier(table)} WHERE ${sql.identifier(scopeColumn)} = ${scope} AND page_key_hash = ${hashKey(pageKey)} LIMIT 1`,
	);
	if (rows.rows[0] && rows.rows[0].page_key !== pageKey) {
		throw new AppError(
			409,
			"PAGE_KEY_HASH_COLLISION",
			"页面标识冲突，请联系管理员。",
		);
	}
}
