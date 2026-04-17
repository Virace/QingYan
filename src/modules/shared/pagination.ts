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
