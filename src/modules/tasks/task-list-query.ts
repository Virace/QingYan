import { ilike, or, type SQLWrapper, sql } from "drizzle-orm";

export interface TaskListQuery {
	limit?: number;
	offset?: number;
	search?: string;
}

export function taskTextSearch(
	search: string | undefined,
	fields: SQLWrapper[],
) {
	const text = search?.trim();
	if (!text) return undefined;
	const pattern = `%${text.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
	return or(...fields.map((field) => ilike(sql`${field}`, pattern)));
}
