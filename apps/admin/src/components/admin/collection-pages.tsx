import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	bulkTrashComments,
	clearTrash,
	createBlacklist,
	createSite,
	deleteBlacklistTarget,
	deleteComment,
	listComments,
	listPages,
	listSites,
	listUsers,
	listVisitors,
	replyToComment,
	type CommentStatus,
	updateComment,
	updateSite,
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
import { Input } from "@/components/ui/input";

import type { AdminView } from "./admin-shell";
import { EmptyState, inputClass, textareaClass } from "./admin-ui";
import { useAdminConfirmDialog } from "./confirm-dialog";

function ResourceFilters({
	search,
	setSearch,
	status,
	setStatus,
	pageKey,
	setPageKey,
	limit,
	setLimit,
}: {
	search: string;
	setSearch: (value: string) => void;
	status?: string;
	setStatus?: (value: string) => void;
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
			{setStatus ? (
				<select
					className={inputClass}
					value={status ?? ""}
					onChange={(event) => setStatus(event.target.value)}
				>
					<option value="">全部状态</option>
					<option value="pending">待审</option>
					<option value="approved">已通过</option>
					<option value="hidden">垃圾与回收站</option>
				</select>
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

export function CommentsPage({
	siteKey,
	search,
	setSearch,
	pageKey,
	setPageKey,
}: {
	siteKey?: string;
	search: string;
	setSearch: (value: string) => void;
	pageKey: string;
	setPageKey: (value: string) => void;
}) {
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const [status, setStatus] = useState("");
	const [hiddenStatus, setHiddenStatus] = useState("");
	const [limit, setLimit] = useState(20);
	const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
	const [selectedCommentIds, setSelectedCommentIds] = useState<string[]>([]);
	const commentsQuery = useQuery({
		queryKey: [
			"admin",
			"comments",
			siteKey,
			search,
			pageKey,
			status,
			hiddenStatus,
			limit,
		],
		queryFn: () =>
			listComments({
				siteKey,
				pageKey,
				search,
				status:
					status === "hidden"
						? ((hiddenStatus || undefined) as "spam" | "trash" | undefined)
						: status === "pending" || status === "approved"
							? status
							: undefined,
				statusGroup:
					status === "hidden" && !hiddenStatus ? "hidden" : undefined,
				limit,
				offset: 0,
			}),
	});
	const updateMutation = useMutation({
		mutationFn: (input: {
			id: string;
			status?: CommentStatus;
			isPinned?: boolean;
			isFolded?: boolean;
		}) => updateComment(input.id, input),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const deleteMutation = useMutation({
		mutationFn: deleteComment,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const bulkTrashMutation = useMutation({
		mutationFn: bulkTrashComments,
		onSuccess: () => {
			setSelectedCommentIds([]);
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const clearTrashMutation = useMutation({
		mutationFn: clearTrash,
		onSuccess: () => {
			setSelectedCommentIds([]);
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const replyMutation = useMutation({
		mutationFn: (input: { commentId: string; raw: string }) =>
			replyToComment(input.commentId, { content: { raw: input.raw } }),
		onSuccess: (_data, variables) => {
			setReplyDrafts((current) => ({
				...current,
				[variables.commentId]: "",
			}));
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const createBlacklistMutation = useMutation({
		mutationFn: createBlacklist,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const deleteBlacklistMutation = useMutation({
		mutationFn: deleteBlacklistTarget,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const toggleCommentBlacklist = (input: {
		targetType: "email" | "ip";
		targetValue: string;
		isBlacklisted: boolean;
	}) => {
		if (input.isBlacklisted) {
			deleteBlacklistMutation.mutate({
				siteKey,
				targetType: input.targetType,
				matchMode: "exact",
				targetValue: input.targetValue,
			});
			return;
		}

		createBlacklistMutation.mutate({
			siteKey,
			targetType: input.targetType,
			matchMode: "exact",
			targetValue: input.targetValue,
			scope: "post",
			reason: "admin_quick_action",
		});
	};
	const blacklistMutationPending =
		createBlacklistMutation.isPending || deleteBlacklistMutation.isPending;
	const isTrashView = status === "hidden" && hiddenStatus === "trash";
	const visibleCommentIds =
		commentsQuery.data?.items.map((comment) => comment.id) ?? [];
	const selectedVisibleIds = selectedCommentIds.filter((commentId) =>
		visibleCommentIds.includes(commentId),
	);
	const selectedTrashIds = (commentsQuery.data?.items ?? [])
		.filter(
			(comment) =>
				selectedCommentIds.includes(comment.id) && comment.status === "trash",
		)
		.map((comment) => comment.id);
	const allVisibleSelected =
		visibleCommentIds.length > 0 &&
		visibleCommentIds.every((commentId) =>
			selectedCommentIds.includes(commentId),
		);

	const toggleSelectedComment = (commentId: string, checked: boolean) => {
		setSelectedCommentIds((current) =>
			checked
				? Array.from(new Set([...current, commentId]))
				: current.filter((value) => value !== commentId),
		);
	};
	const toggleAllVisibleComments = (checked: boolean) => {
		setSelectedCommentIds((current) =>
			checked
				? Array.from(new Set([...current, ...visibleCommentIds]))
				: current.filter((commentId) => !visibleCommentIds.includes(commentId)),
		);
	};
	const moveCommentsToTrash = async (commentIds: string[]) => {
		if (commentIds.length === 0) {
			return;
		}
		const confirmed = await confirm({
			title: "移入回收站",
			description: `确认将 ${commentIds.length} 条评论移入回收站？可在回收站中恢复。`,
			confirmText: "移入回收站",
		});
		if (!confirmed) {
			return;
		}
		bulkTrashMutation.mutate(commentIds);
	};
	const permanentlyDeleteComment = async (commentId: string) => {
		const confirmed = await confirm({
			title: "永久删除评论",
			description: "确认永久删除这条回收站评论？此操作不可恢复。",
			confirmText: "永久删除",
			destructive: true,
		});
		if (!confirmed) {
			return;
		}
		deleteMutation.mutate(commentId);
	};
	const clearCurrentTrash = async () => {
		const confirmed = await confirm({
			title: "清空回收站",
			description: "确认清空当前站点回收站？此操作不可恢复。",
			confirmText: "清空回收站",
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
				<CardTitle className="text-lg">评论</CardTitle>
				<CardDescription>审核、置顶、折叠或删除评论。</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<ResourceFilters
					search={search}
					setSearch={setSearch}
					status={status}
					setStatus={(value) => {
						setStatus(value);
						if (value !== "hidden") {
							setHiddenStatus("");
						}
					}}
					pageKey={pageKey}
					setPageKey={setPageKey}
					limit={limit}
					setLimit={setLimit}
				/>
				{status === "hidden" ? (
					<div className="flex max-w-xs flex-col gap-2">
						<label
							className="text-xs text-muted-foreground"
							htmlFor="admin-comments-hidden-status"
						>
							垃圾与回收站状态
						</label>
						<select
							id="admin-comments-hidden-status"
							className={inputClass}
							value={hiddenStatus}
							onChange={(event) => setHiddenStatus(event.target.value)}
						>
							<option value="">全部</option>
							<option value="spam">Akismet 垃圾</option>
							<option value="trash">回收站</option>
						</select>
					</div>
				) : null}
				<p className="text-xs text-muted-foreground">
					共 {commentsQuery.data?.pagination.totalCount ?? "-"} 条，当前显示{" "}
					{commentsQuery.data?.items.length ?? 0} 条。
				</p>
				<div className="flex flex-wrap gap-2">
					{isTrashView ? (
						<Button
							type="button"
							size="sm"
							variant="destructive"
							disabled={
								selectedTrashIds.length === 0 || deleteMutation.isPending
							}
							onClick={async () => {
								if (selectedTrashIds.length === 0) {
									return;
								}
								const confirmed = await confirm({
									title: "永久删除评论",
									description: `确认永久删除 ${selectedTrashIds.length} 条回收站评论？此操作不可恢复。`,
									confirmText: "永久删除",
									destructive: true,
								});
								if (!confirmed) {
									return;
								}
								for (const commentId of selectedTrashIds) {
									deleteMutation.mutate(commentId);
								}
								setSelectedCommentIds([]);
							}}
						>
							永久删除
							{selectedTrashIds.length ? ` (${selectedTrashIds.length})` : ""}
						</Button>
					) : (
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={
								selectedVisibleIds.length === 0 || bulkTrashMutation.isPending
							}
							onClick={() => moveCommentsToTrash(selectedVisibleIds)}
						>
							移入回收站
							{selectedVisibleIds.length
								? ` (${selectedVisibleIds.length})`
								: ""}
						</Button>
					)}
					{isTrashView ? (
						<Button
							type="button"
							size="sm"
							variant="destructive"
							disabled={clearTrashMutation.isPending}
							onClick={clearCurrentTrash}
						>
							清空回收站
						</Button>
					) : null}
				</div>
				{commentsQuery.data?.items.length ? (
					<div className="overflow-x-auto rounded-md border">
						<table className="w-full text-left text-sm">
							<thead className="bg-muted/60">
								<tr>
									<th className="p-3">
										<input
											type="checkbox"
											aria-label="选择当前页评论"
											checked={allVisibleSelected}
											onChange={(event) =>
												toggleAllVisibleComments(event.target.checked)
											}
										/>
									</th>
									<th className="p-3">状态</th>
									<th className="p-3">作者</th>
									<th className="p-3">页面</th>
									<th className="p-3">内容</th>
									<th className="p-3">操作</th>
								</tr>
							</thead>
							<tbody>
								{commentsQuery.data.items.map((comment) => (
									<tr key={comment.id} className="border-t">
										<td className="p-3">
											<input
												type="checkbox"
												aria-label={`选择评论 ${comment.id}`}
												checked={selectedCommentIds.includes(comment.id)}
												onChange={(event) =>
													toggleSelectedComment(
														comment.id,
														event.target.checked,
													)
												}
											/>
										</td>
										<td className="p-3">
											<Badge
												variant={
													comment.status === "approved"
														? "secondary"
														: comment.status === "spam"
															? "destructive"
															: "outline"
												}
											>
												{comment.status === "approved"
													? "已通过"
													: comment.status === "spam"
														? "Akismet 垃圾"
														: comment.status === "trash"
															? "回收站"
															: "待审"}
											</Badge>
										</td>
										<td className="p-3">
											<p className="font-medium">{comment.authorName}</p>
											<p className="text-xs text-muted-foreground">
												{comment.authorEmail ?? "-"}
											</p>
											<p className="text-xs text-muted-foreground">
												IP {comment.authorIp ?? "-"}
											</p>
											<p className="max-w-48 truncate text-xs text-muted-foreground">
												UA {comment.authorUserAgent ?? "-"}
											</p>
											<div className="mt-2 flex flex-wrap gap-1">
												{comment.blacklist.email ? (
													<Badge variant="destructive">邮箱黑名单</Badge>
												) : null}
												{comment.blacklist.ip ? (
													<Badge variant="destructive">IP 黑名单</Badge>
												) : null}
											</div>
										</td>
										<td className="max-w-56 p-3">
											<p className="truncate">{comment.pageTitle ?? "-"}</p>
											<p className="truncate text-xs text-muted-foreground">
												{comment.pageKey}
											</p>
										</td>
										<td className="max-w-80 p-3">
											<p className="line-clamp-2">{comment.contentRaw}</p>
											<p className="text-xs text-muted-foreground">
												赞 {comment.voteUpCount} / 回复 {comment.replyCount}
											</p>
										</td>
										<td className="p-3">
											<div className="flex flex-wrap gap-2">
												<Button
													type="button"
													size="sm"
													variant="outline"
													onClick={() =>
														updateMutation.mutate({
															id: comment.id,
															status:
																comment.status === "approved"
																	? "pending"
																	: "approved",
														})
													}
												>
													{comment.status === "approved" ? "待审" : "通过"}
												</Button>
												{comment.status !== "pending" ? (
													<Button
														type="button"
														size="sm"
														variant="outline"
														onClick={() =>
															updateMutation.mutate({
																id: comment.id,
																status: "pending",
															})
														}
													>
														待审
													</Button>
												) : null}
												{comment.status !== "spam" ? (
													<Button
														type="button"
														size="sm"
														variant="outline"
														onClick={() =>
															updateMutation.mutate({
																id: comment.id,
																status: "spam",
															})
														}
													>
														垃圾
													</Button>
												) : null}
												<Button
													type="button"
													size="sm"
													variant="outline"
													onClick={() =>
														updateMutation.mutate({
															id: comment.id,
															isPinned: !comment.isPinned,
														})
													}
												>
													{comment.isPinned ? "取消置顶" : "置顶"}
												</Button>
												<Button
													type="button"
													size="sm"
													variant="outline"
													onClick={() =>
														updateMutation.mutate({
															id: comment.id,
															isFolded: !comment.isFolded,
														})
													}
												>
													{comment.isFolded ? "展开" : "折叠"}
												</Button>
												{comment.status === "trash" ? (
													<Button
														type="button"
														size="sm"
														variant="outline"
														onClick={() =>
															updateMutation.mutate({
																id: comment.id,
																status: "pending",
															})
														}
													>
														恢复
													</Button>
												) : (
													<Button
														type="button"
														size="sm"
														variant="outline"
														disabled={bulkTrashMutation.isPending}
														onClick={() => moveCommentsToTrash([comment.id])}
													>
														移入回收站
													</Button>
												)}
												{isTrashView ? (
													<Button
														type="button"
														size="sm"
														variant="destructive"
														onClick={() => permanentlyDeleteComment(comment.id)}
													>
														永久删除
													</Button>
												) : null}
												{comment.authorEmail ? (
													<Button
														type="button"
														size="sm"
														variant={
															comment.blacklist.email
																? "destructive"
																: "outline"
														}
														disabled={blacklistMutationPending}
														onClick={() =>
															toggleCommentBlacklist({
																targetType: "email",
																targetValue: comment.authorEmail ?? "",
																isBlacklisted: comment.blacklist.email,
															})
														}
													>
														{comment.blacklist.email ? "解除邮箱" : "拉黑邮箱"}
													</Button>
												) : null}
												{comment.authorIp ? (
													<Button
														type="button"
														size="sm"
														variant={
															comment.blacklist.ip ? "destructive" : "outline"
														}
														disabled={blacklistMutationPending}
														onClick={() =>
															toggleCommentBlacklist({
																targetType: "ip",
																targetValue: comment.authorIp ?? "",
																isBlacklisted: comment.blacklist.ip,
															})
														}
													>
														{comment.blacklist.ip ? "解除 IP" : "拉黑 IP"}
													</Button>
												) : null}
											</div>
											<form
												className="mt-3 flex flex-col gap-2"
												onSubmit={(event) => {
													event.preventDefault();
													const raw = (replyDrafts[comment.id] ?? "").trim();
													if (!raw) {
														return;
													}
													replyMutation.mutate({
														commentId: comment.id,
														raw,
													});
												}}
											>
												<textarea
													className={textareaClass}
													rows={2}
													placeholder="快速回复"
													value={replyDrafts[comment.id] ?? ""}
													onChange={(event) =>
														setReplyDrafts((current) => ({
															...current,
															[comment.id]: event.target.value,
														}))
													}
												/>
												<Button
													type="submit"
													size="sm"
													variant="outline"
													disabled={
														replyMutation.isPending ||
														!(replyDrafts[comment.id] ?? "").trim()
													}
												>
													回复
												</Button>
											</form>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<EmptyState text={commentsQuery.isLoading ? "加载中" : "暂无评论"} />
				)}
			</CardContent>
		</Card>
	);
}

export function PagesPage({
	siteKey,
	openComments,
}: {
	siteKey?: string;
	openComments: (input: { pageKey?: string; search?: string }) => void;
}) {
	const [search, setSearch] = useState("");
	const query = useQuery({
		queryKey: ["admin", "pages", siteKey, search],
		queryFn: () => listPages({ siteKey, search, limit: 50, offset: 0 }),
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">页面</CardTitle>
				<CardDescription>页面级评论、访客和点赞聚合。</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<ResourceFilters search={search} setSearch={setSearch} />
				<div className="grid gap-3">
					{query.data?.items.map((page) => (
						<div key={page.pageKey} className="rounded-md border p-4">
							<div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
								<div className="min-w-0">
									<p className="font-medium">
										{page.pageTitle ?? page.pageKey}
									</p>
									<p className="truncate text-xs text-muted-foreground">
										{page.pageUrl ?? page.pageKey}
									</p>
								</div>
								<div className="flex flex-wrap gap-2">
									<Badge variant="secondary">评论 {page.commentCount}</Badge>
									<Badge variant="outline">访客 {page.visitorCount}</Badge>
									<Badge variant="outline">用户 {page.userCount}</Badge>
									<Badge variant="outline">点赞 {page.pageLikeCount}</Badge>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => openComments({ pageKey: page.pageKey })}
									>
										查看评论
									</Button>
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

export function UsersPage({
	siteKey,
	openComments,
}: {
	siteKey?: string;
	openComments: (input: { pageKey?: string; search?: string }) => void;
}) {
	const [search, setSearch] = useState("");
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: ["admin", "users", siteKey, search],
		queryFn: () => listUsers({ siteKey, search, limit: 50, offset: 0 }),
	});
	const createBlacklistMutation = useMutation({
		mutationFn: createBlacklist,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const deleteBlacklistMutation = useMutation({
		mutationFn: deleteBlacklistTarget,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const toggleUserBlacklist = (input: {
		targetValue: string;
		isBlacklisted: boolean;
	}) => {
		if (input.isBlacklisted) {
			deleteBlacklistMutation.mutate({
				siteKey,
				targetType: "email",
				matchMode: "exact",
				targetValue: input.targetValue,
			});
			return;
		}

		createBlacklistMutation.mutate({
			siteKey,
			targetType: "email",
			matchMode: "exact",
			targetValue: input.targetValue,
			scope: "post",
			reason: "admin_quick_action",
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">用户</CardTitle>
				<CardDescription>按邮箱聚合评论用户。</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<ResourceFilters search={search} setSearch={setSearch} />
				<div className="overflow-x-auto rounded-md border">
					<table className="w-full text-left text-sm">
						<thead className="bg-muted/60">
							<tr>
								<th className="p-3">邮箱</th>
								<th className="p-3">昵称</th>
								<th className="p-3">评论</th>
								<th className="p-3">页面</th>
								<th className="p-3">状态</th>
								<th className="p-3">操作</th>
							</tr>
						</thead>
						<tbody>
							{query.data?.items.map((user) => (
								<tr key={user.email} className="border-t">
									<td className="p-3">{user.email}</td>
									<td className="p-3">
										<p>{user.names.join(", ")}</p>
										<p className="text-xs text-muted-foreground">
											IP {user.ips.join(", ") || "-"}
										</p>
										<p className="max-w-64 truncate text-xs text-muted-foreground">
											UA {user.userAgents.join(" | ") || "-"}
										</p>
									</td>
									<td className="p-3">
										{user.commentCount}，待审 {user.pendingCount}
									</td>
									<td className="p-3">{user.pageCount}</td>
									<td className="p-3">
										{user.blacklist.email ? (
											<Badge variant="destructive">黑名单</Badge>
										) : (
											<Badge variant="secondary">正常</Badge>
										)}
									</td>
									<td className="p-3">
										<div className="flex flex-wrap gap-2">
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={() => openComments({ search: user.email })}
											>
												查看评论
											</Button>
											<Button
												type="button"
												size="sm"
												variant={
													user.blacklist.email ? "destructive" : "outline"
												}
												disabled={
													createBlacklistMutation.isPending ||
													deleteBlacklistMutation.isPending
												}
												onClick={() =>
													toggleUserBlacklist({
														targetValue: user.email,
														isBlacklisted: user.blacklist.email,
													})
												}
											>
												{user.blacklist.email ? "解除邮箱" : "拉黑邮箱"}
											</Button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</CardContent>
		</Card>
	);
}

export function VisitorsPage({
	siteKey,
	openComments,
}: {
	siteKey?: string;
	openComments: (input: { pageKey?: string; search?: string }) => void;
}) {
	const [search, setSearch] = useState("");
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: ["admin", "visitors", siteKey, search],
		queryFn: () => listVisitors({ siteKey, search, limit: 50, offset: 0 }),
	});
	const createBlacklistMutation = useMutation({
		mutationFn: createBlacklist,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const deleteBlacklistMutation = useMutation({
		mutationFn: deleteBlacklistTarget,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const toggleVisitorBlacklist = (input: {
		targetValue: string;
		isBlacklisted: boolean;
	}) => {
		if (input.isBlacklisted) {
			deleteBlacklistMutation.mutate({
				siteKey,
				targetType: "visitor",
				matchMode: "exact",
				targetValue: input.targetValue,
			});
			return;
		}

		createBlacklistMutation.mutate({
			siteKey,
			targetType: "visitor",
			matchMode: "exact",
			targetValue: input.targetValue,
			scope: "post",
			reason: "admin_quick_action",
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">访客</CardTitle>
				<CardDescription>按 visitorKey 聚合访问与评论行为。</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<ResourceFilters search={search} setSearch={setSearch} />
				<div className="grid gap-3">
					{query.data?.items.map((visitor) => (
						<div key={visitor.visitorKey} className="rounded-md border p-4">
							<div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
								<div className="min-w-0">
									<p className="truncate font-medium">{visitor.visitorKey}</p>
									<p className="text-xs text-muted-foreground">
										{visitor.emails.join(", ") || "无邮箱"}
									</p>
									<p className="text-xs text-muted-foreground">
										IP {visitor.ips.join(", ") || "-"}
									</p>
									<p className="max-w-xl truncate text-xs text-muted-foreground">
										UA {visitor.userAgents.join(" | ") || "-"}
									</p>
								</div>
								<div className="flex flex-wrap gap-2">
									<Badge variant="secondary">评论 {visitor.commentCount}</Badge>
									<Badge variant="outline">页面 {visitor.pageCount}</Badge>
									{visitor.blacklist.visitor ? (
										<Badge variant="destructive">访客黑名单</Badge>
									) : null}
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => openComments({ search: visitor.visitorKey })}
									>
										查看评论
									</Button>
									<Button
										type="button"
										size="sm"
										variant={
											visitor.blacklist.visitor ? "destructive" : "outline"
										}
										disabled={
											createBlacklistMutation.isPending ||
											deleteBlacklistMutation.isPending
										}
										onClick={() =>
											toggleVisitorBlacklist({
												targetValue: visitor.visitorKey,
												isBlacklisted: visitor.blacklist.visitor,
											})
										}
									>
										{visitor.blacklist.visitor ? "解除访客" : "拉黑访客"}
									</Button>
								</div>
							</div>
						</div>
					))}
					{query.data?.items.length === 0 ? (
						<EmptyState text="暂无访客" />
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}

export function SitesPage({
	openSite,
}: {
	openSite: (siteKey: string, view: AdminView) => void;
}) {
	const queryClient = useQueryClient();
	const [siteKey, setSiteKey] = useState("");
	const [name, setName] = useState("");
	const [origin, setOrigin] = useState("");
	const query = useQuery({
		queryKey: ["admin", "sites"],
		queryFn: listSites,
	});
	const createMutation = useMutation({
		mutationFn: createSite,
		onSuccess: () => {
			setSiteKey("");
			setName("");
			setOrigin("");
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const updateMutation = useMutation({
		mutationFn: (input: {
			siteKey: string;
			name: string;
			allowedOrigins: string[];
		}) =>
			updateSite(input.siteKey, {
				name: input.name,
				allowedOrigins: input.allowedOrigins,
			}),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const allowedOrigin = origin.trim();

	return (
		<div className="grid gap-4 lg:grid-cols-[360px_1fr]">
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">新增站点</CardTitle>
					<CardDescription>创建站点后可继续配置站点设置。</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="flex flex-col gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							if (!siteKey.trim() || !name.trim() || !allowedOrigin) {
								return;
							}
							createMutation.mutate({
								siteKey: siteKey.trim(),
								name: name.trim(),
								allowedOrigins: [allowedOrigin],
							});
						}}
					>
						<Input
							placeholder="siteKey"
							value={siteKey}
							onChange={(event) => setSiteKey(event.target.value)}
						/>
						<Input
							placeholder="站点名称"
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
						<Input
							placeholder="前端站点 Origin，例如 https://example.com"
							value={origin}
							onChange={(event) => setOrigin(event.target.value)}
						/>
						<Button type="submit" disabled={createMutation.isPending}>
							创建站点
						</Button>
					</form>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">站点</CardTitle>
					<CardDescription>配置站点和站点设置摘要。</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3 md:grid-cols-2">
					{query.data?.items.map((site) => {
						const draftOrigin = site.allowedOrigins[0] ?? "";
						return (
							<div key={site.siteKey} className="rounded-md border p-4">
								<p className="font-medium">{site.name}</p>
								<p className="text-xs text-muted-foreground">{site.siteKey}</p>
								<form
									className="mt-3 grid gap-2"
									onSubmit={(event) => {
										event.preventDefault();
										const form = new FormData(event.currentTarget);
										const nextName = String(form.get("name") ?? "").trim();
										const nextOrigin = String(form.get("origin") ?? "").trim();
										if (!nextName || !nextOrigin) {
											return;
										}
										updateMutation.mutate({
											siteKey: site.siteKey,
											name: nextName,
											allowedOrigins: [nextOrigin],
										});
									}}
								>
									<Input name="name" defaultValue={site.name} />
									<Input name="origin" defaultValue={draftOrigin} />
									<Button
										type="submit"
										size="sm"
										variant="outline"
										disabled={updateMutation.isPending}
									>
										保存站点
									</Button>
								</form>
								<div className="mt-3 flex flex-wrap gap-2">
									<Badge variant="secondary">页面 {site.pageCount}</Badge>
									<Badge variant="outline">评论 {site.commentCount}</Badge>
									<Badge variant="outline">用户 {site.userCount}</Badge>
									<Badge variant="outline">访客 {site.visitorCount}</Badge>
								</div>
								<p className="mt-3 text-xs text-muted-foreground">
									{draftOrigin || "-"}
								</p>
								<div className="mt-4 flex flex-wrap gap-2">
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => openSite(site.siteKey, "settings")}
									>
										站点设置
									</Button>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => openSite(site.siteKey, "pages")}
									>
										页面
									</Button>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => openSite(site.siteKey, "users")}
									>
										用户
									</Button>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => openSite(site.siteKey, "visitors")}
									>
										访客
									</Button>
								</div>
							</div>
						);
					})}
				</CardContent>
			</Card>
		</div>
	);
}
