import { useState } from "react";
import { Dialog } from "@radix-ui/themes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createBlacklist, deleteBlacklist, listBlacklist } from "@/api/admin";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { PaginationControls } from "../shared/admin-pagination";
import { EmptyState, Field, inputClass } from "../shared/admin-ui";
import { useAdminConfirmDialog } from "../shared/confirm-dialog";
import {
	blacklistMatchModeLabels,
	blacklistTargetTypeLabels,
	labelFor,
	scopeLabels,
} from "../shared/display-labels";
export function BlacklistPage({ siteKey }: { siteKey?: string }) {
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const [createOpen, setCreateOpen] = useState(false);
	const [targetValue, setTargetValue] = useState("");
	const [reason, setReason] = useState("");
	const [search, setSearch] = useState("");
	const [limit, setLimitState] = useState(20);
	const [pageIndex, setPageIndex] = useState(0);
	const offset = pageIndex * limit;
	const setLimit = (nextLimit: number) => {
		setLimitState(nextLimit);
		setPageIndex(0);
	};
	const [targetType, setTargetType] = useState<"ip" | "email" | "visitor">(
		"email",
	);
	const [matchMode, setMatchMode] = useState<"exact" | "cidr" | "wildcard">(
		"exact",
	);
	const [scope, setScope] = useState<"post" | "all">("post");
	const query = useQuery({
		queryKey: ["admin", "blacklist", siteKey, search, limit, offset],
		queryFn: () => listBlacklist({ siteKey, search, limit, offset }),
	});
	const createMutation = useMutation({
		mutationFn: createBlacklist,
		onSuccess() {
			setTargetValue("");
			setReason("");
			setCreateOpen(false);
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const deleteMutation = useMutation({
		mutationFn: deleteBlacklist,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const removeRule = async (ruleId: number) => {
		const confirmed = await confirm({
			title: "删除黑名单规则",
			description: "确认删除这条黑名单规则？删除后目标会恢复评论或访问能力。",
			confirmText: "删除规则",
			destructive: true,
		});
		if (!confirmed) {
			return;
		}
		deleteMutation.mutate(ruleId);
	};

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
					<div>
						<CardTitle className="text-lg">黑名单规则</CardTitle>
						<CardDescription>
							按邮箱、访客或 IP 管理评论与访问拦截规则。
						</CardDescription>
					</div>
					<Button type="button" onClick={() => setCreateOpen(true)}>
						新增规则
					</Button>
				</div>
			</CardHeader>
			<CardContent className="grid gap-3">
				<Input
					placeholder="搜索黑名单"
					value={search}
					onChange={(event) => {
						setSearch(event.target.value);
						setPageIndex(0);
					}}
				/>
				<PaginationControls
					limit={limit}
					pageIndex={pageIndex}
					totalCount={query.data?.pagination.totalCount ?? 0}
					itemCount={query.data?.items.length ?? 0}
					setLimit={setLimit}
					setPageIndex={setPageIndex}
				/>
				{query.data?.items.map((rule) => (
					<div key={rule.id} className="rounded-md border p-3">
						<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
							<div>
								<p className="font-medium">{rule.targetValue}</p>
								<p className="text-xs text-muted-foreground">
									{labelFor(blacklistTargetTypeLabels, rule.targetType)} /{" "}
									{labelFor(blacklistMatchModeLabels, rule.matchMode)} /{" "}
									{labelFor(scopeLabels, rule.scope)}
									{rule.reason ? ` / ${rule.reason}` : ""}
									{rule.expiresAt ? ` / 过期 ${rule.expiresAt}` : ""}
								</p>
							</div>
							<Button
								type="button"
								size="sm"
								variant="destructive"
								onClick={() => void removeRule(rule.id)}
							>
								删除
							</Button>
						</div>
					</div>
				))}
				{query.data?.items.length === 0 ? (
					<EmptyState text="暂无黑名单规则" />
				) : null}
				<Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
					<Dialog.Content maxWidth="520px">
						<Dialog.Title>新增黑名单规则</Dialog.Title>
						<Dialog.Description size="2">
							确认后创建规则；取消不会保留新规则草稿。
						</Dialog.Description>
						<form
							className="mt-4 flex flex-col gap-3"
							onSubmit={(event) => {
								event.preventDefault();
								if (!targetValue.trim()) {
									return;
								}
								createMutation.mutate({
									siteKey,
									targetType,
									matchMode,
									scope,
									targetValue,
									reason: reason || undefined,
								});
							}}
						>
							<Field label="目标类型">
								<select
									className={inputClass}
									value={targetType}
									onChange={(event) =>
										setTargetType(event.target.value as typeof targetType)
									}
								>
									<option value="email">邮箱</option>
									<option value="visitor">访客</option>
									<option value="ip">IP</option>
								</select>
							</Field>
							<Field label="匹配模式">
								<select
									className={inputClass}
									value={matchMode}
									onChange={(event) =>
										setMatchMode(event.target.value as typeof matchMode)
									}
								>
									<option value="exact">精确</option>
									<option value="wildcard">通配</option>
									<option value="cidr">CIDR</option>
								</select>
							</Field>
							<Field label="作用域">
								<select
									className={inputClass}
									value={scope}
									onChange={(event) =>
										setScope(event.target.value as typeof scope)
									}
								>
									<option value="post">当前页面</option>
									<option value="all">全局</option>
								</select>
							</Field>
							<Field label="目标值">
								<Input
									value={targetValue}
									onChange={(event) => setTargetValue(event.target.value)}
								/>
							</Field>
							<Field label="原因">
								<Input
									value={reason}
									onChange={(event) => setReason(event.target.value)}
								/>
							</Field>
							<div className="flex justify-end gap-2">
								<Dialog.Close>
									<Button type="button" variant="outline">
										取消
									</Button>
								</Dialog.Close>
								<Button type="submit" disabled={createMutation.isPending}>
									新增规则
								</Button>
							</div>
						</form>
					</Dialog.Content>
				</Dialog.Root>
			</CardContent>
		</Card>
	);
}
