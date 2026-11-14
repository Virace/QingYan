import { sql } from "drizzle-orm";
import { bigint, index, pgTable } from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-users";
import { jsonText, exactText as text, utcTimestamp } from "./column-types";
import { sites } from "./sites";

export const delayedDeletions = pgTable(
	"delayed_deletions",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		resourceType: text("resource_type").notNull(),
		resourceId: text("resource_id").notNull(),
		siteId: bigint("site_id", { mode: "number" }).references(() => sites.id),
		requestedByUserId: bigint("requested_by_user_id", {
			mode: "number",
		}).references(() => adminUsers.id),
		requestedAt: utcTimestamp("requested_at").notNull(),
		hardDeleteAfter: utcTimestamp("hard_delete_after").notNull(),
		restoredByUserId: bigint("restored_by_user_id", {
			mode: "number",
		}).references(() => adminUsers.id),
		restoredAt: utcTimestamp("restored_at"),
		hardDeletedAt: utcTimestamp("hard_deleted_at"),
		status: text("status").notNull().default("pending"),
		metadataJson: jsonText("metadata_json"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("delayed_deletions_status_due_idx").on(
			table.status,
			table.hardDeleteAfter,
		),
		index("delayed_deletions_site_id_idx").on(table.siteId),
		index("delayed_deletions_resource_idx").on(
			table.resourceType,
			table.resourceId,
		),
	],
);
