import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
	type AdminPage,
	type AdminPageSortBy,
	type AdminPageSortOrder,
	approvePendingPage,
	clearPageTrash,
	deletePage,
	ignorePendingPage,
	listPages,
	listPendingPages,
	refreshPageTitle,
	rejectPendingPage,
	restorePage,
	trashPage,
} from "@/api/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { PaginationControls } from "../shared/admin-pagination";
import { EmptyState, inputClass } from "../shared/admin-ui";
import { useAdminConfirmDialog } from "../shared/confirm-dialog";
import { ExternalLinkText } from "../shared/external-link-text";
import {
	pageSortOptions,
	pageStatusLabel,
	pageStatusOptions,
	type PageStatusFilter,
	ResourceFilters,
	usePaginationState,
} from "./collection-shared";

export function PagesPage({
	siteKey,
	openComments,
}: {
	siteKey?: string;
	openComments: (input: { pageKey?: string; search?: string }) => void;
}) {
	const [search, setSearch] = useState("");
	const [status, setStatus] = useState<PageStatusFilter>("all");
	const [sortBy, setSortBy] = useState<AdminPageSortBy>("updatedAt");
	const [sortOrder, setSortOrder] = useState<AdminPageSortOrder>("desc");
	const pagePagination = usePaginationState(20);
	const pendingPagePagination = usePaginationState(20);
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const query = useQuery({
		queryKey: [
			"admin",
			"pages",
			siteKey,
			search,
			status,
			sortBy,
			sortOrder,
			pagePagination.limit,
			pagePagination.offset,
		],
		queryFn: () =>
			listPages({
				siteKey,
				search,
				status: status === "all" ? undefined : status,
				sortBy,
				sortOrder,
				limit: pagePagination.limit,
				offset: pagePagination.offset,
			}),
	});
	const pendingQuery = useQuery({
		queryKey: [
			"admin",
			"page-registry",
			"pending",
			siteKey,
			search,
			pendingPagePagination.limit,
			pendingPagePagination.offset,
		],
		queryFn: () =>
			listPendingPages({
				siteKey,
				search,
				status: "pending",
				limit: pendingPagePagination.limit,
				offset: pendingPagePagination.offset,
			}),
	});
	const invalidatePages = () => {
		void queryClient.invalidateQueries({ queryKey: ["admin", "pages"] });
		void queryClient.invalidateQueries({
			queryKey: ["admin", "page-registry", "pending"],
		});
	};
	const trashMutation = useMutation({
		mutationFn: trashPage,
		onSuccess: invalidatePages,
	});
	const restoreMutation = useMutation({
		mutationFn: restorePage,
		onSuccess: invalidatePages,
	});
	const deleteMutation = useMutation({
		mutationFn: deletePage,
		onSuccess: invalidatePages,
	});
	const clearTrashMutation = useMutation({
		mutationFn: clearPageTrash,
		onSuccess: invalidatePages,
	});
	const refreshTitleMutation = useMutation({
		mutationFn: refreshPageTitle,
		onSuccess: invalidatePages,
	});
	const approveMutation = useMutation({
		mutationFn: approvePendingPage,
		onSuccess: invalidatePages,
	});
	const rejectMutation = useMutation({
		mutationFn: rejectPendingPage,
		onSuccess: invalidatePages,
	});
	const ignoreMutation = useMutation({
		mutationFn: ignorePendingPage,
		onSuccess: invalidatePages,
	});
	const lifecyclePending =
		trashMutation.isPending ||
		restoreMutation.isPending ||
		deleteMutation.isPending ||
		clearTrashMutation.isPending ||
		approveMutation.isPending ||
		rejectMutation.isPending ||
		ignoreMutation.isPending;
	const mutatePage = async (
		page: AdminPage,
		action: "trash" | "restore" | "delete",
	) => {
		const input = { siteKey: page.siteKey, pageKey: page.pageKey };
		if (action === "trash") {
			const confirmed = await confirm({
				title: "移入回收站",
				description:
					"页面将进入回收站，公开评论、点赞和访问统计入口会被排除。该操作可恢复，但仍会影响站点交互。",
				confirmText: "移入回收站",
				destructive: true,
			});
			if (!confirmed) {
				return;
			}
			trashMutation.mutate(input);
			return;
		}
		if (action === "restore") {
			restoreMutation.mutate(input);
			return;
		}
		const confirmed = await confirm({
			title: "删除页面",
			description:
				"页面将进入系统删除策略：默认保留恢复窗口；若删除保留天数为 0，会立即永久删除且无法从 QingYan 恢复。",
			confirmText: "删除页面",
			destructive: true,
		});
		if (!confirmed) {
			return;
		}
		deleteMutation.mutate(input);
	};
	const clearPageTrashForSite = async () => {
		const confirmed = await confirm({
			title: "清空页面回收站",
			description:
				"当前站点回收站中的页面会按系统删除策略处理；删除保留天数为 0 时会立即永久删除，无法从 QingYan 恢复。",
			confirmText: "清空页面回收站",
			destructive: true,
		});
		if (!confirmed) {
			return;
		}
		clearTrashMutation.mutate({ siteKey });
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">页面</CardTitle>
				<CardDescription>
					页面级评论、访客、点赞聚合与页面状态治理。
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<ResourceFilters
					search={search}
					setSearch={(value) => {
						setSearch(value);
						pagePagination.resetPage();
						pendingPagePagination.resetPage();
					}}
				/>
				<label className="grid gap-1 text-sm md:max-w-xs">
					<span className="text-muted-foreground">页面状态</span>
					<select
						className={inputClass}
						value={status}
						onChange={(event) => {
							setStatus(event.target.value as PageStatusFilter);
							pagePagination.resetPage();
						}}
					>
						{pageStatusOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>
				{status === "trash" ? (
					<div className="flex justify-end">
						<Button
							type="button"
							variant="destructive"
							disabled={lifecyclePending}
							onClick={() => void clearPageTrashForSite()}
						>
							清空页面回收站
						</Button>
					</div>
				) : null}
				<div className="flex flex-col gap-3 md:flex-row">
					<label className="grid gap-1 text-sm md:w-56">
						<span className="text-muted-foreground">排序字段</span>
						<select
							className={inputClass}
							value={sortBy}
							onChange={(event) => {
								setSortBy(event.target.value as AdminPageSortBy);
								pagePagination.resetPage();
							}}
						>
							{pageSortOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label className="grid gap-1 text-sm md:w-36">
						<span className="text-muted-foreground">排序方向</span>
						<select
							className={inputClass}
							value={sortOrder}
							onChange={(event) => {
								setSortOrder(event.target.value as AdminPageSortOrder);
								pagePagination.resetPage();
							}}
						>
							<option value="desc">降序</option>
							<option value="asc">升序</option>
						</select>
					</label>
				</div>
				<div className="grid gap-3 rounded-md border p-4">
					<div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
						<div>
							<h3 className="font-medium">待处理未知页面</h3>
							<p className="text-xs text-muted-foreground">
								来自公开访问但尚未登记的页面。
							</p>
						</div>
						<Badge variant="outline">
							{pendingQuery.data?.pagination.totalCount ?? 0}
						</Badge>
					</div>
					<PaginationControls
						limit={pendingPagePagination.limit}
						pageIndex={pendingPagePagination.pageIndex}
						totalCount={pendingQuery.data?.pagination.totalCount ?? 0}
						itemCount={pendingQuery.data?.items.length ?? 0}
						setLimit={pendingPagePagination.setLimit}
						setPageIndex={pendingPagePagination.setPageIndex}
					/>
					{pendingQuery.data?.items.map((candidate) => (
						<div
							key={candidate.pageKey}
							className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-start md:justify-between"
						>
							<div className="min-w-0">
								<p className="truncate font-medium">{candidate.pageKey}</p>
								<ExternalLinkText href={candidate.pageUrl} className="text-xs">
									{candidate.pageUrl}
								</ExternalLinkText>
								<p className="text-xs text-muted-foreground">
									访问 {candidate.hitCount} / 最近 {candidate.lastSeenAt}
								</p>
							</div>
							<div className="flex flex-wrap gap-2">
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={lifecyclePending}
									onClick={() =>
										approveMutation.mutate({
											siteKey: candidate.siteKey,
											pageKey: candidate.pageKey,
										})
									}
								>
									放行
								</Button>
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={lifecyclePending}
									onClick={() =>
										rejectMutation.mutate({
											siteKey: candidate.siteKey,
											pageKey: candidate.pageKey,
											reason: "admin_rejected",
										})
									}
								>
									拒绝
								</Button>
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={lifecyclePending}
									onClick={() =>
										ignoreMutation.mutate({
											siteKey: candidate.siteKey,
											pageKey: candidate.pageKey,
											reason: "admin_ignored",
										})
									}
								>
									忽略
								</Button>
							</div>
						</div>
					))}
					{pendingQuery.data?.items.length === 0 ? (
						<EmptyState text="暂无待处理页面" />
					) : null}
				</div>
				<div className="grid gap-3">
					<PaginationControls
						limit={pagePagination.limit}
						pageIndex={pagePagination.pageIndex}
						totalCount={query.data?.pagination.totalCount ?? 0}
						itemCount={query.data?.items.length ?? 0}
						setLimit={pagePagination.setLimit}
						setPageIndex={pagePagination.setPageIndex}
					/>
					{query.data?.items.map((page) => (
						<div
							key={page.pageKey}
							className={`rounded-md border p-4 ${
								page.status === "stale" ||
								page.status === "unreachable" ||
								page.status === "not_found"
									? "border-amber-300 bg-amber-50"
									: ""
							}`}
						>
							<div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
								<div className="min-w-0">
									<p className="font-medium">
										{page.pageTitle ?? page.pageKey}
									</p>
									<ExternalLinkText href={page.pageUrl} className="text-xs">
										{page.pageUrl ?? page.pageKey}
									</ExternalLinkText>
									{page.titleRefreshError ? (
										<p className="mt-1 text-xs text-amber-700">
											Title 刷新错误：{page.titleRefreshError}
											{page.titleRefreshStatusCode
												? ` / HTTP ${page.titleRefreshStatusCode}`
												: ""}
										</p>
									) : null}
								</div>
								<div className="flex flex-wrap gap-2">
									<Badge variant="secondary">
										{pageStatusLabel(page.status)}
									</Badge>
									<Badge variant="secondary">评论 {page.commentCount}</Badge>
									<Badge variant="outline">访客 {page.visitorCount}</Badge>
									<Badge variant="outline">评论者 {page.commenterCount}</Badge>
									<Badge variant="outline">点赞 {page.pageLikeCount}</Badge>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => openComments({ pageKey: page.pageKey })}
									>
										查看评论
									</Button>
									<Button
										type="button"
										size="sm"
										variant="outline"
										title="为当前页面创建维护任务，执行状态可在任务中心查看。"
										disabled={!siteKey || refreshTitleMutation.isPending}
										onClick={() => {
											if (!siteKey) {
												return;
											}
											refreshTitleMutation.mutate({
												siteKey,
												pageKey: page.pageKey,
											});
										}}
									>
										创建 Title 任务
									</Button>
									{page.status === "active" || page.status === "stale" ? (
										<Button
											type="button"
											size="sm"
											variant="destructive"
											disabled={lifecyclePending}
											onClick={() => void mutatePage(page, "trash")}
										>
											移入回收站
										</Button>
									) : null}
									{page.status === "trash" ? (
										<>
											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={lifecyclePending}
												onClick={() => mutatePage(page, "restore")}
											>
												恢复
											</Button>
											<Button
												type="button"
												size="sm"
												variant="destructive"
												disabled={lifecyclePending}
												onClick={() => void mutatePage(page, "delete")}
											>
												删除页面
											</Button>
										</>
									) : null}
								</div>
							</div>
						</div>
					))}
					{query.data?.items.length === 0 ? (
						<EmptyState text="暂无页面" />
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}
