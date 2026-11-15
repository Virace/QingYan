import { Dialog } from "@radix-ui/themes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { actOnWafSync, listWafSync, type WafSyncItem } from "@/api/waf";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaginationControls } from "../shared/admin-pagination";
import { Field } from "../shared/admin-ui";
import { useAdminConfirmDialog } from "../shared/confirm-dialog";

const localLabels = { active: "限制中", released: "已解除", expired: "已到期" };
const wafLabels = {
	unknown: "尚未确认",
	present: "规则已配置",
	absent: "没有此项限制",
	conflict: "面板已有改动",
};
const syncLabels = {
	pending: "等待同步",
	synced: "已核对",
	failed: "同步失败",
	conflict: "需人工确认",
};
const reasonLabels: Record<string, string> = {
	WAF_RULE_CHANGED: "面板中的规则已被修改，自动同步已暂停。",
	WAF_RULE_REMOVED:
		"面板中的规则已被删除，自动同步已暂停。本地限制仍按原状态执行。",
	WAF_SHARED_IP_REVIEW: "观察到多个评论者共用此地址，请先确认整站限制的影响。",
	WAF_SITE_MAPPING_CHANGED: "站点对应关系已变更，请由部署者核对后重试。",
	WAF_GATEWAY_UNAVAILABLE: "暂时无法连接面板，请核对服务后重试。",
	WAF_GATEWAY_REJECTED: "面板未接受请求，请由部署者核对接口权限后重试。",
	WAF_GATEWAY_RESPONSE_INVALID: "面板返回暂不可识别，请由部署者核对接口版本。",
	WAF_EXPIRED: "已按原到期时间解除面板限制。",
	WAF_RELEASED: "已核对面板中的解除结果。",
};

function errorMessage(error: unknown) {
	if (error instanceof ApiError && error.code === "WAF_REVIEW_REQUIRED")
		return "请先核对面板改动，再选择恢复同步。";
	if (error instanceof ApiError && error.code === "WAF_SYNC_UNAVAILABLE")
		return "请由部署者检查面板连接和维护状态，再重试。";
	return "操作未完成，请保留当前输入，稍后重试。";
}

export function WafSyncPanel({ siteKey }: { siteKey: string }) {
	const [limit, setLimit] = useState(20);
	const [pageIndex, setPageIndex] = useState(0);
	const [releaseItem, setReleaseItem] = useState<WafSyncItem | null>(null);
	const [reason, setReason] = useState("");
	const confirm = useAdminConfirmDialog();
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: ["admin", "waf", siteKey, limit, pageIndex],
		queryFn: () => listWafSync(siteKey, limit, pageIndex * limit),
	});
	const mutation = useMutation({
		mutationFn: (input: {
			id: string;
			action: "release" | "retry" | "resume";
			reason?: string;
		}) => actOnWafSync(input.id, input.action, input.reason),
		onSuccess: async (response, input) => {
			setReleaseItem(null);
			setReason("");
			await queryClient.invalidateQueries({ queryKey: ["admin"] });
			toast.success(
				input.action === "release"
					? response.panelSync === "review_required"
						? "本地限制已解除。面板存在手动改动，请核对后恢复同步。"
						: response.panelSync === "paused"
							? "本地限制已解除。维护结束后继续处理面板限制。"
							: "本地限制已解除，面板结果将在同步后更新。"
					: "已提交同步，请刷新查看面板结果。",
			);
		},
	});
	const resume = async (item: WafSyncItem) => {
		if (
			await confirm({
				title: "恢复面板同步",
				description:
					item.localState === "active"
						? "将限制此 IP 对整个站点的访问，并覆盖这条规则在面板中的手动改动。共用此出口的其他访客也会受到影响。"
						: "将清理面板中这条已解除或已到期的限制。",
				confirmText: "恢复同步",
			})
		)
			mutation.mutate({ id: item.id, action: "resume" });
	};
	return (
		<section className="grid gap-3" aria-label="面板访问限制">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-medium">面板访问限制</h3>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => void query.refetch()}
					disabled={query.isFetching}
				>
					刷新状态
				</Button>
			</div>
			{query.isPending ? (
				<p className="text-sm text-muted-foreground">正在读取面板限制状态…</p>
			) : query.isError ? (
				<Alert variant="destructive">
					<AlertTitle>暂时无法读取访问限制</AlertTitle>
					<AlertDescription>请点击“刷新状态”重试。</AlertDescription>
				</Alert>
			) : (
				<>
					{!query.data.configured ? (
						<p className="text-sm text-muted-foreground">
							当前站点未配置面板同步，请由部署者配置连接和站点对应关系。
						</p>
					) : query.data.paused ? (
						<p className="text-sm text-muted-foreground">
							维护期间暂停同步，维护结束后会继续核对。
						</p>
					) : null}
					<p className="text-xs text-muted-foreground">
						到期后由 QingYan
						解除面板限制；服务停机期间到期的限制会在恢复后处理。
					</p>
					{query.data.evidence?.gapReason ? (
						<Alert>
							<AlertTitle>防护事件存在证据缺口</AlertTitle>
							<AlertDescription>
								曾发现面板日志保留、分页或时间信息不完整，请结合面板日志核对；未采集到事件不能证明没有发生访问。
							</AlertDescription>
						</Alert>
					) : null}
					{mutation.isError && !releaseItem ? (
						<Alert variant="destructive">
							<AlertDescription>
								{errorMessage(mutation.error)}
							</AlertDescription>
						</Alert>
					) : null}
					{query.data.items.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							当前站点还没有面板限制记录。
						</p>
					) : (
						<div className="divide-y rounded-md border">
							{query.data.items.map((item) => (
								<article
									key={item.id}
									className="grid gap-2 p-3 md:grid-cols-[minmax(0,1fr)_auto]"
								>
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2">
											<span className="break-all font-mono text-sm">
												{item.ip}
											</span>
											<Badge variant="outline">
												本地：{localLabels[item.localState]}
											</Badge>
											<Badge
												variant={
													item.wafState === "present"
														? "destructive"
														: "secondary"
												}
											>
												面板：{wafLabels[item.wafState]}
											</Badge>
											<Badge
												variant={
													item.syncState === "failed" ||
													item.syncState === "conflict"
														? "destructive"
														: "outline"
												}
											>
												{syncLabels[item.syncState]}
											</Badge>
										</div>
										<p className="mt-1 text-xs text-muted-foreground">
											到期：{new Date(item.expiresAt).toLocaleString()}
											；最近核对：
											{item.lastSyncedAt
												? new Date(item.lastSyncedAt).toLocaleString()
												: "尚未完成"}
										</p>
										{item.reasonCode ? (
											<p className="mt-1 text-sm">
												{reasonLabels[item.reasonCode] ??
													"请核对当前限制与面板状态后重试。"}
											</p>
										) : null}
									</div>
									<div className="flex shrink-0 flex-wrap items-start gap-2">
										{item.suspended ? (
											<Button
												size="sm"
												variant="outline"
												disabled={
													mutation.isPending ||
													!query.data.configured ||
													query.data.paused ||
													!query.data.capabilities.retry
												}
												onClick={() => void resume(item)}
											>
												恢复同步
											</Button>
										) : (
											<Button
												size="sm"
												variant="outline"
												disabled={
													mutation.isPending ||
													!query.data.configured ||
													query.data.paused ||
													!query.data.capabilities.retry
												}
												onClick={() =>
													mutation.mutate({ id: item.id, action: "retry" })
												}
											>
												重试同步
											</Button>
										)}
										{item.localState === "active" ? (
											<Button
												size="sm"
												variant="outline"
												disabled={
													mutation.isPending || !query.data.capabilities.release
												}
												onClick={() => {
													mutation.reset();
													setReleaseItem(item);
													setReason("");
												}}
											>
												{item.suspended ? "解除本地限制" : "申请解除限制"}
											</Button>
										) : null}
									</div>
								</article>
							))}
						</div>
					)}
					<PaginationControls
						limit={limit}
						pageIndex={pageIndex}
						totalCount={query.data.totalCount}
						itemCount={query.data.items.length}
						setLimit={(value) => {
							setLimit(value);
							setPageIndex(0);
						}}
						setPageIndex={setPageIndex}
					/>
				</>
			)}
			<Dialog.Root
				open={Boolean(releaseItem)}
				onOpenChange={(open) => {
					if (!open && !mutation.isPending) setReleaseItem(null);
				}}
			>
				<Dialog.Content maxWidth="440px">
					<Dialog.Title>解除访问限制</Dialog.Title>
					<Dialog.Description size="2">
						{releaseItem?.suspended
							? `解除 ${releaseItem.ip} 的本地限制。面板已有手动改动，将保留其状态；请核对后恢复同步或在面板处理。`
							: `解除 ${releaseItem?.ip} 的本地限制，并申请解除面板中的对应限制。`}
					</Dialog.Description>
					<div className="mt-4 grid gap-3">
						<Field label="解除原因">
							<Input
								value={reason}
								maxLength={500}
								onChange={(event) => setReason(event.target.value)}
							/>
						</Field>
						{mutation.isError ? (
							<p role="alert" className="text-sm text-destructive">
								{errorMessage(mutation.error)}
							</p>
						) : null}
						<div className="flex justify-end gap-2">
							<Button
								variant="outline"
								disabled={mutation.isPending}
								onClick={() => setReleaseItem(null)}
							>
								取消
							</Button>
							<Button
								disabled={mutation.isPending || !reason.trim()}
								onClick={() => {
									if (releaseItem)
										mutation.mutate({
											id: releaseItem.id,
											action: "release",
											reason: reason.trim(),
										});
								}}
							>
								解除限制
							</Button>
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Root>
		</section>
	);
}
