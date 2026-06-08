export interface PaginationInput {
	sortBy?: string;
	limit?: number;
	offset?: number;
}

export interface PaginationOptions {
	sortBy: "newest" | "oldest";
	limit: number;
	offset: number;
}

export function normalizePagination(input: PaginationInput): PaginationOptions {
	const limit = Number.isFinite(input.limit)
		? Math.min(Math.max(Number(input.limit), 1), 100)
		: 20;
	const offset = Number.isFinite(input.offset)
		? Math.max(Number(input.offset), 0)
		: 0;

	return {
		sortBy: input.sortBy === "oldest" ? "oldest" : "newest",
		limit,
		offset,
	};
}

export interface LimitOffsetInput {
	limit?: number;
	offset?: number;
}

export function normalizeLimitOffset(input: LimitOffsetInput = {}) {
	return {
		limit: Math.min(Math.max(input.limit ?? 20, 1), 100),
		offset: Math.max(input.offset ?? 0, 0),
	};
}

export function buildPaginationResult<T>(
	items: T[],
	pagination: { limit: number; offset: number; totalCount: number },
) {
	return { items, pagination };
}

export function paginateArray<T>(
	items: readonly T[],
	input: { limit: number; offset: number },
) {
	return items.slice(input.offset, input.offset + input.limit);
}
