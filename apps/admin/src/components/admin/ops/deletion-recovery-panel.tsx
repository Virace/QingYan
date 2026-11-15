import { useId, useState } from "react";
import { Dialog } from "@radix-ui/themes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon, Undo2Icon } from "lucide-react";

import { ApiError } from "@/api/client";
import {
	type DelayedDeletion,
	type DelayedDeletionStatus,
	listDelayedDeletions,
	restoreDelayedDeletion,
} from "@/api/ops";
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

function formatTime(value: string) {
	return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function recoveryError(error: unknown) {
	if (error instanceof ApiError) {
		switch (error.code) {
			case "ADMIN_PERMISSION_REQUIRED":
			case "ADMIN_SITE_ACCESS_REQUIRED":
				return "没有恢复此内容的权限，请联系管理员核对站点与操作权限。";
			case "DELAYED_DELETION_EXPIRED":
				return "恢复期限已过。关闭此窗口并刷新列表查看当前状态。";
			case "DELAYED_DELETION_NOT_PENDING":
				return "内容已经恢复或永久删除。关闭此窗口并刷新列表查看当前状态。";
			case "DELAYED_DELETION_NOT_FOUND":
			case "DELAYED_DELETION_RESOURCE_UNAVAILABLE":
			case "PAGE_NOT_FOUND":
				return "原内容已不可用。关闭此窗口并刷新列表；仍有疑问时请联系管理员。";
			case "DELAYED_DELETION_RESOURCE_UNSUPPORTED":
				return "此类内容暂不支持在后台恢复，请联系管理员处理。";
		}
	}
	return "恢复失败，请稍后重试；若持续失败，请联系管理员检查服务状态。";
}

function statusLabel(record: DelayedDeletion) {
	if (record.status === "restored") return "已恢复";
	if (record.status === "hard_deleted") return "已永久删除";
	if (new Date(record.hardDeleteAfter).getTime() <= Date.now())
		return "恢复期限已过";
	return record.canRestore ? "可恢复" : "原删除内容不可恢复";
}

export function DeletionRecoveryPanel({
	siteKey,
	canRestore,
}: {
	siteKey?: string;
	canRestore: boolean;
}) {
	const statusId = useId();
	const [status, setStatus] = useState<DelayedDeletionStatus>("pending");
	const [limit, setLimit] = useState(20);
	const [pageIndex, setPageIndex] = useState(0);
	const [selected, setSelected] = useState<DelayedDeletion | null>(null);
	const [notice, setNotice] = useState("");
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: [
			"admin",
			"ops",
			"delayed-deletions",
			siteKey,
			status,
			limit,
			pageIndex,
		],
		queryFn: () =>
			listDelayedDeletions({
				siteKey,
				status,
				limit,
				offset: pageIndex * limit,
			}),
	});
	const restoreMutation = useMutation({
		mutationFn: restoreDelayedDeletion,
		meta: {
			suppressGlobalErrorToast: true,
			suppressGlobalSuccessToast: true,
		},
		onSuccess: async (response) => {
			setSelected(null);
			setNotice(`已恢复 ${response.resource.restoredCount} 个页面。`);
			setPageIndex(0);
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ["admin", "ops", "delayed-deletions"],
				}),
				queryClient.invalidateQueries({ queryKey: ["admin", "pages"] }),
			]);
		},
	});
	return (
		<Card id="deletion-recovery" className="scroll-mt-4">
			<CardHeader>
				<CardTitle className="text-lg">删除恢复</CardTitle>
				<CardDescription>
					在恢复截止时间前找回已删除的页面及关联内容。
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<label
						htmlFor={statusId}
						className="grid gap-1 text-sm w-full max-w-xs"
					>
						<span className="text-muted-foreground">删除记录</span>
						<select
							id={statusId}
							className={inputClass}
							value={status}
							onChange={(event) => {
								setStatus(event.target.value as DelayedDeletionStatus);
								setPageIndex(0);
								setNotice("");
							}}
						>
							<option value="pending">待恢复</option>
							<option value="restored">已恢复</option>
							<option value="hard_deleted">已永久删除</option>
						</select>
					</label>
					<Button
						variant="outline"
						disabled={query.isFetching}
						onClick={() => void query.refetch()}
					>
						<RefreshCwIcon data-icon="inline-start" />
						刷新记录
					</Button>
				</div>
				{!canRestore ? (
					<p className="text-sm text-muted-foreground">
						当前账号可以查看删除记录；恢复内容需要管理员授予恢复权限。
					</p>
				) : null}
				{notice ? (
					<p
						role="status"
						className="text-sm text-emerald-700 dark:text-emerald-300"
					>
						{notice}
					</p>
				) : null}
				{query.isError ? (
					<p role="alert" className="text-sm text-destructive">
						删除记录加载失败，请刷新重试；若持续失败，请联系管理员核对权限与服务状态。
					</p>
				) : query.isLoading ? (
					<EmptyState text="正在加载删除记录" />
				) : query.data?.items.length ? (
					<ul
						className="divide-y rounded-md border"
						aria-label="删除记录列表"
						aria-busy={query.isFetching}
					>
						{query.data.items.map((record) => (
							<li
								key={record.id}
								className="grid gap-3 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(14rem,auto)_auto] xl:items-center"
							>
								<div className="min-w-0 grid gap-1">
									<div className="flex flex-wrap items-start gap-2">
										<span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
											{record.displayName}
										</span>
										<Badge variant="outline" className="shrink-0">
											{record.resourceType === "page_trash"
												? "回收站批量删除"
												: "页面"}
										</Badge>
									</div>
									<p className="text-xs text-muted-foreground break-words">
										{record.siteName || record.siteKey || "全部站点"}
									</p>
								</div>
								<dl className="grid gap-1 text-xs text-muted-foreground">
									<div>
										<dt className="inline">删除时间：</dt>
										<dd className="inline">{formatTime(record.requestedAt)}</dd>
									</div>
									<div>
										<dt className="inline">恢复截止：</dt>
										<dd className="inline">
											{formatTime(record.hardDeleteAfter)}
										</dd>
									</div>
									{record.restoredAt ? (
										<div>
											<dt className="inline">恢复时间：</dt>
											<dd className="inline">
												{formatTime(record.restoredAt)}
											</dd>
										</div>
									) : null}
								</dl>
								<div className="flex shrink-0 items-center justify-between gap-3 xl:justify-end">
									<Badge
										variant={
											record.status === "restored" ? "secondary" : "outline"
										}
									>
										{statusLabel(record)}
									</Badge>
									{record.status === "pending" ? (
										<Button
											size="sm"
											variant="outline"
											disabled={
												!canRestore ||
												!record.canRestore ||
												new Date(record.hardDeleteAfter).getTime() <=
													Date.now() ||
												restoreMutation.isPending
											}
											onClick={() => {
												restoreMutation.reset();
												setSelected(record);
											}}
										>
											<Undo2Icon data-icon="inline-start" />
											恢复内容
										</Button>
									) : null}
								</div>
							</li>
						))}
					</ul>
				) : (
					<EmptyState
						text={
							status === "pending"
								? "当前站点没有待恢复的删除记录"
								: "当前站点没有此类删除记录"
						}
					/>
				)}
				<PaginationControls
					limit={limit}
					pageIndex={pageIndex}
					totalCount={query.data?.totalCount ?? 0}
					itemCount={query.data?.items.length ?? 0}
					setLimit={(value) => {
						setLimit(Math.max(1, Math.min(100, value)));
						setPageIndex(0);
					}}
					setPageIndex={setPageIndex}
				/>
				<Dialog.Root
					open={selected !== null}
					onOpenChange={(open) => {
						if (!open && !restoreMutation.isPending) setSelected(null);
					}}
				>
					<Dialog.Content
						maxWidth="480px"
						aria-busy={restoreMutation.isPending}
					>
						<Dialog.Title>恢复删除内容</Dialog.Title>
						<Dialog.Description
							size="2"
							className="break-words [overflow-wrap:anywhere]"
						>
							确认恢复“{selected?.displayName}
							”？页面将重新启用，关联的评论和访问数据将重新可用。
						</Dialog.Description>
						{restoreMutation.isError ? (
							<p role="alert" className="mt-4 text-sm text-destructive">
								{recoveryError(restoreMutation.error)}
							</p>
						) : null}
						<div className="mt-5 flex justify-end gap-2">
							<Button
								variant="outline"
								disabled={restoreMutation.isPending}
								onClick={() => setSelected(null)}
							>
								取消
							</Button>
							<Button
								disabled={restoreMutation.isPending || !selected}
								onClick={() => {
									if (selected) restoreMutation.mutate(selected.id);
								}}
							>
								{restoreMutation.isPending ? "正在恢复…" : "恢复内容"}
							</Button>
						</div>
					</Dialog.Content>
				</Dialog.Root>
			</CardContent>
		</Card>
	);
}
