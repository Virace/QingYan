import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { adminUsers } from "./admin-users";
import { sites } from "./sites";

export const delayedDeletions = sqliteTable(
	"delayed_deletions",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		resourceType: text("resource_type").notNull(),
		resourceId: text("resource_id").notNull(),
		siteId: integer("site_id").references(() => sites.id),
		requestedByUserId: integer("requested_by_user_id").references(
			() => adminUsers.id,
		),
		requestedAt: text("requested_at").notNull(),
		hardDeleteAfter: text("hard_delete_after").notNull(),
		restoredByUserId: integer("restored_by_user_id").references(
			() => adminUsers.id,
		),
		restoredAt: text("restored_at"),
		hardDeletedAt: text("hard_deleted_at"),
		status: text("status").notNull().default("pending"),
		metadataJson: text("metadata_json"),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
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
