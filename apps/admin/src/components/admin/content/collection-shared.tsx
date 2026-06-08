import { useState } from "react";

import type { AdminPageSortBy, PageRegistryStatus } from "@/api/admin";
import { Input } from "@/components/ui/input";

export type PageStatusFilter = "all" | PageRegistryStatus;

export const pageStatusOptions: Array<{
	value: PageStatusFilter;
	label: string;
}> = [
	{ value: "all", label: "全部" },
	{ value: "active", label: "正常" },
	{ value: "trash", label: "回收站" },
	{ value: "deleted", label: "已删除" },
	{ value: "ignored", label: "已忽略" },
	{ value: "stale", label: "待同步" },
	{ value: "unreachable", label: "不可达" },
	{ value: "not_found", label: "404" },
];

export function pageStatusLabel(status: PageRegistryStatus) {
	const labels: Record<PageRegistryStatus, string> = {
		active: "正常",
		stale: "待同步",
		unreachable: "不可达",
		not_found: "404",
		trash: "回收站",
		deleted: "已删除",
		ignored: "已忽略",
	};
	return labels[status];
}

export const pageSortOptions: Array<{ value: AdminPageSortBy; label: string }> =
	[
		{ value: "updatedAt", label: "最近更新" },
		{ value: "createdAt", label: "创建时间" },
		{ value: "commentCount", label: "评论数" },
		{ value: "visitorCount", label: "访客数" },
		{ value: "commenterCount", label: "评论者数" },
		{ value: "pageLikeCount", label: "点赞数" },
		{ value: "title", label: "标题" },
		{ value: "pageKey", label: "页面键" },
	];

export type PaginationState = {
	limit: number;
	offset: number;
	pageIndex: number;
	setLimit: (limit: number) => void;
	setPageIndex: (pageIndex: number) => void;
	resetPage: () => void;
};

export function usePaginationState(defaultLimit = 20): PaginationState {
	const [limit, setLimitState] = useState(defaultLimit);
	const [pageIndex, setPageIndexState] = useState(0);
	const setLimit = (nextLimit: number) => {
		setLimitState(nextLimit);
		setPageIndexState(0);
	};
	const setPageIndex = (nextPageIndex: number) => {
		setPageIndexState(Math.max(0, nextPageIndex));
	};

	return {
		limit,
		offset: pageIndex * limit,
		pageIndex,
		setLimit,
		setPageIndex,
		resetPage: () => setPageIndexState(0),
	};
}

export function ResourceFilters({
	search,
	setSearch,
	pageKey,
	setPageKey,
	limit,
	setLimit,
}: {
	search: string;
	setSearch: (value: string) => void;
	pageKey?: string;
	setPageKey?: (value: string) => void;
	limit?: number;
	setLimit?: (value: number) => void;
}) {
	return (
		<div className="flex flex-col gap-3 md:flex-row">
			<Input
				placeholder="搜索"
				value={search}
				onChange={(event) => setSearch(event.target.value)}
			/>
			{setPageKey ? (
				<Input
					placeholder="页面键"
					value={pageKey ?? ""}
					onChange={(event) => setPageKey(event.target.value)}
				/>
			) : null}
			{setLimit ? (
				<Input
					type="number"
					min={1}
					max={100}
					value={limit ?? 20}
					onChange={(event) => setLimit(Number(event.target.value) || 20)}
				/>
			) : null}
		</div>
	);
}
