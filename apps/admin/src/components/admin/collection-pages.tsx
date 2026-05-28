import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	bulkUpdateComments,
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
	refreshCommentMetadata,
	refreshSelectedCommentMetadata,
	replyToComment,
	type AdminComment,
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
import { EmptyState, inputClass } from "./admin-ui";
import type { CommentActionId } from "./comment-actions";
import { CommentsList } from "./comments-list";
import { useAdminConfirmDialog } from "./confirm-dialog";

type CommentView = "all" | "pending" | "approved" | "spam" | "trash";
type BulkCommentAction =
	| "approve"
	| "pending"
	| "spam"
	| "trash"
	| "restore"
	| "delete"
	| "pin"
	| "unpin"
	| "fold"
	| "unfold"
	| "refreshMetadata";

const commentViews: Array<{
	id: CommentView;
	label: string;
	status?: CommentStatus;
}> = [
	{ id: "all", label: "全部" },
	{ id: "pending", label: "待审", status: "pending" },
	{ id: "approved", label: "已通过", status: "approved" },
	{ id: "spam", label: "垃圾", status: "spam" },
	{ id: "trash", label: "回收站", status: "trash" },
];

function ResourceFilters({
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
	const [view, setView] = useState<CommentView>("all");
	const [limit, setLimit] = useState(20);
	const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
	const [selectedCommentIds, setSelectedCommentIds] = useState<string[]>([]);
	const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
	const [bulkAction, setBulkAction] = useState<BulkCommentAction>("approve");
	const currentView =
		commentViews.find((item) => item.id === view) ?? commentViews[0];
	const commentsQuery = useQuery({
		queryKey: ["admin", "comments", siteKey, search, pageKey, view, limit],
		queryFn: () =>
			listComments({
				siteKey,
				pageKey,
				search,
				status: currentView.status,
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
	const refreshMetadataMutation = useMutation({
		mutationFn: refreshCommentMetadata,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const bulkTrashMutation = useMutation({
		mutationFn: bulkTrashComments,
		onSuccess: () => {
			setSelectedCommentIds([]);
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const bulkUpdateMutation = useMutation({
		mutationFn: bulkUpdateComments,
		onSuccess: () => {
			setSelectedCommentIds([]);
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const bulkRefreshMetadataMutation = useMutation({
		mutationFn: refreshSelectedCommentMetadata,
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
	const isTrashView = view === "trash";
	const visibleCommentIds =
		commentsQuery.data?.items.map((comment) => comment.id) ?? [];
	const selectedVisibleIds = selectedCommentIds.filter((commentId) =>
		visibleCommentIds.includes(commentId),
	);
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
	const handleCommentAction = (
		comment: AdminComment,
		action: CommentActionId,
	) => {
		if (action === "approve") {
			updateMutation.mutate({ id: comment.id, status: "approved" });
			return;
		}
		if (action === "pending") {
			updateMutation.mutate({ id: comment.id, status: "pending" });
			return;
		}
		if (action === "spam") {
			updateMutation.mutate({ id: comment.id, status: "spam" });
			return;
		}
		if (action === "trash") {
			void moveCommentsToTrash([comment.id]);
			return;
		}
		if (action === "restore") {
			updateMutation.mutate({ id: comment.id, status: "pending" });
			return;
		}
		if (action === "delete") {
			void permanentlyDeleteComment(comment.id);
		}
	};
	const applyBulkAction = async () => {
		const ids = selectedVisibleIds;
		if (ids.length === 0) {
			return;
		}
		if (bulkAction === "delete") {
			const confirmed = await confirm({
				title: "永久删除评论",
				description: `确认永久删除 ${ids.length} 条评论？此操作不可恢复。`,
				confirmText: "永久删除",
				destructive: true,
			});
			if (!confirmed) {
				return;
			}
			for (const commentId of ids) {
				deleteMutation.mutate(commentId);
			}
			setSelectedCommentIds([]);
			return;
		}
		if (bulkAction === "refreshMetadata") {
			bulkRefreshMetadataMutation.mutate(ids);
			return;
		}
		if (bulkAction === "trash") {
			await moveCommentsToTrash(ids);
			return;
		}

		const patchByAction: Record<
			Exclude<BulkCommentAction, "delete" | "refreshMetadata" | "trash">,
			{ status?: CommentStatus; isPinned?: boolean; isFolded?: boolean }
		> = {
			approve: { status: "approved" },
			pending: { status: "pending" },
			spam: { status: "spam" },
			restore: { status: "pending" },
			pin: { isPinned: true },
			unpin: { isPinned: false },
			fold: { isFolded: true },
			unfold: { isFolded: false },
		};
		bulkUpdateMutation.mutate({
			commentIds: ids,
			patch: patchByAction[bulkAction],
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">评论</CardTitle>
				<CardDescription>审核、置顶、折叠或删除评论。</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="flex flex-wrap gap-2 text-sm">
					{commentViews.map((item) => (
						<Button
							key={item.id}
							type="button"
							size="sm"
							variant={view === item.id ? "secondary" : "ghost"}
							onClick={() => {
								setView(item.id);
								setSelectedCommentIds([]);
							}}
						>
							{item.label}
						</Button>
					))}
				</div>
				<ResourceFilters
					search={search}
					setSearch={setSearch}
					pageKey={pageKey}
					setPageKey={setPageKey}
					limit={limit}
					setLimit={setLimit}
				/>
				<p className="text-xs text-muted-foreground">
					共 {commentsQuery.data?.pagination.totalCount ?? "-"} 条，当前显示{" "}
					{commentsQuery.data?.items.length ?? 0} 条。
				</p>
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm text-muted-foreground">
						已选择 {selectedVisibleIds.length} 条
					</span>
					<select
						className={inputClass}
						value={bulkAction}
						onChange={(event) =>
							setBulkAction(event.target.value as BulkCommentAction)
						}
					>
						<option value="approve">批准</option>
						<option value="pending">设为待审</option>
						<option value="spam">标记为垃圾</option>
						<option value="trash">移入回收站</option>
						<option value="restore">恢复为待审</option>
						<option value="pin">置顶</option>
						<option value="unpin">取消置顶</option>
						<option value="fold">折叠</option>
						<option value="unfold">展开</option>
						<option value="refreshMetadata">刷新 IP 地址信息</option>
						<option value="delete">永久删除</option>
					</select>
					<Button
						type="button"
						size="sm"
						variant={bulkAction === "delete" ? "destructive" : "outline"}
						disabled={
							selectedVisibleIds.length === 0 ||
							bulkUpdateMutation.isPending ||
							bulkRefreshMetadataMutation.isPending ||
							bulkTrashMutation.isPending ||
							deleteMutation.isPending
						}
						onClick={applyBulkAction}
					>
						应用
					</Button>
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
					<CommentsList
						comments={commentsQuery.data.items}
						selectedCommentIds={selectedCommentIds}
						allVisibleSelected={allVisibleSelected}
						activeReplyId={activeReplyId}
						replyDrafts={replyDrafts}
						mutationPending={
							updateMutation.isPending ||
							deleteMutation.isPending ||
							bulkTrashMutation.isPending ||
							bulkUpdateMutation.isPending ||
							bulkRefreshMetadataMutation.isPending ||
							refreshMetadataMutation.isPending ||
							blacklistMutationPending
						}
						onToggleAll={toggleAllVisibleComments}
						onToggleOne={toggleSelectedComment}
						onAction={handleCommentAction}
						onTogglePinned={(comment) =>
							updateMutation.mutate({
								id: comment.id,
								isPinned: !comment.isPinned,
							})
						}
						onToggleFolded={(comment) =>
							updateMutation.mutate({
								id: comment.id,
								isFolded: !comment.isFolded,
							})
						}
						onReplyOpen={setActiveReplyId}
						onReplyCancel={() => setActiveReplyId(null)}
						onReplyDraftChange={(commentId, value) =>
							setReplyDrafts((current) => ({
								...current,
								[commentId]: value,
							}))
						}
						onReplySubmit={(commentId) => {
							const raw = (replyDrafts[commentId] ?? "").trim();
							if (!raw) {
								return;
							}
							replyMutation.mutate({ commentId, raw });
							setActiveReplyId(null);
						}}
						onRefreshMetadata={(commentId) =>
							refreshMetadataMutation.mutate(commentId)
						}
						onToggleEmailBlacklist={(comment) =>
							toggleCommentBlacklist({
								targetType: "email",
								targetValue: comment.authorEmail ?? "",
								isBlacklisted: comment.blacklist.email,
							})
						}
						onToggleIpBlacklist={(comment) =>
							toggleCommentBlacklist({
								targetType: "ip",
								targetValue: comment.authorIp ?? "",
								isBlacklisted: comment.blacklist.ip,
							})
						}
					/>
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
