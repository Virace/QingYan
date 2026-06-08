import { useState } from "react";
import { Dialog } from "@radix-ui/themes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	type AdminAllowlistRule,
	createAllowlistRule,
	createBlacklist,
	deleteAllowlistRule,
	deleteBlacklist,
	listAllowlistRules,
	listBlacklist,
	updateAllowlistRule,
} from "@/api/admin";
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
	allowlistMatchModeLabels,
	blacklistMatchModeLabels,
	blacklistTargetTypeLabels,
	labelFor,
	scopeLabels,
} from "../shared/display-labels";

type TargetType = "ip" | "email" | "visitor";
type BlacklistMatchMode = "exact" | "cidr" | "wildcard";
type AllowlistMatchMode = "exact" | "cidr" | "domain";
type Scope = "post" | "all";

const allowlistModeOptions: Record<TargetType, AllowlistMatchMode[]> = {
	ip: ["exact", "cidr"],
	email: ["exact", "domain"],
	visitor: ["exact"],
};

function normalizeAllowlistMode(
	targetType: TargetType,
	matchMode: AllowlistMatchMode,
): AllowlistMatchMode {
	return allowlistModeOptions[targetType].includes(matchMode)
		? matchMode
		: allowlistModeOptions[targetType][0];
}

function formatExpiry(expiresAt: string | null) {
	return expiresAt ? `过期 ${expiresAt}` : "长期有效";
}

function toDatetimeLocalValue(value?: string | null) {
	if (!value) {
		return "";
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "";
	}
	return date.toISOString().slice(0, 16);
}

function fromDatetimeLocalValue(value: string) {
	if (!value) {
		return undefined;
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function buildEmptyAllowlistForm(siteKey?: string) {
	return {
		siteKey,
		global: !siteKey,
		targetType: "ip" as TargetType,
		matchMode: "exact" as AllowlistMatchMode,
		scope: "all" as Scope,
		targetValue: "",
		reason: "",
		expiresAt: "",
	};
}

export function BlacklistPage({ siteKey }: { siteKey?: string }) {
	const [activeList, setActiveList] = useState<"blacklist" | "allowlist">(
		"blacklist",
	);

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
					<div>
						<CardTitle className="text-lg">安全规则</CardTitle>
						<CardDescription>
							管理黑名单拦截规则与白名单豁免规则。
						</CardDescription>
					</div>
					<div className="inline-flex h-9 overflow-hidden rounded-md border bg-background">
						<Button
							type="button"
							variant={activeList === "blacklist" ? "secondary" : "ghost"}
							className="h-full rounded-none"
							onClick={() => setActiveList("blacklist")}
						>
							黑名单
						</Button>
						<Button
							type="button"
							variant={activeList === "allowlist" ? "secondary" : "ghost"}
							className="h-full rounded-none"
							onClick={() => setActiveList("allowlist")}
						>
							白名单
						</Button>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				{activeList === "blacklist" ? (
					<BlacklistRulesPanel siteKey={siteKey} />
				) : (
					<AllowlistRulesPanel siteKey={siteKey} />
				)}
			</CardContent>
		</Card>
	);
}

function BlacklistRulesPanel({ siteKey }: { siteKey?: string }) {
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const [createOpen, setCreateOpen] = useState(false);
	const [targetValue, setTargetValue] = useState("");
	const [reason, setReason] = useState("");
	const [search, setSearch] = useState("");
	const [limit, setLimitState] = useState(20);
	const [pageIndex, setPageIndex] = useState(0);
	const offset = pageIndex * limit;
	const [targetType, setTargetType] = useState<TargetType>("email");
	const [matchMode, setMatchMode] = useState<BlacklistMatchMode>("exact");
	const [scope, setScope] = useState<Scope>("post");
	const setLimit = (nextLimit: number) => {
		setLimitState(nextLimit);
		setPageIndex(0);
	};
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
		if (confirmed) {
			deleteMutation.mutate(ruleId);
		}
	};

	return (
		<div className="grid gap-3">
			<div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_12rem]">
				<Input
					placeholder="搜索黑名单"
					value={search}
					onChange={(event) => {
						setSearch(event.target.value);
						setPageIndex(0);
					}}
				/>
				<Button type="button" onClick={() => setCreateOpen(true)}>
					新增规则
				</Button>
			</div>
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
								{rule.expiresAt ? ` / ${formatExpiry(rule.expiresAt)}` : ""}
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
									setTargetType(event.target.value as TargetType)
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
									setMatchMode(event.target.value as BlacklistMatchMode)
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
								onChange={(event) => setScope(event.target.value as Scope)}
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
		</div>
	);
}

function AllowlistRulesPanel({ siteKey }: { siteKey?: string }) {
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingRule, setEditingRule] = useState<AdminAllowlistRule | null>(
		null,
	);
	const [form, setForm] = useState(() => buildEmptyAllowlistForm(siteKey));
	const [search, setSearch] = useState("");
	const [targetTypeFilter, setTargetTypeFilter] = useState<TargetType | "all">(
		"all",
	);
	const [limit, setLimitState] = useState(20);
	const [pageIndex, setPageIndex] = useState(0);
	const offset = pageIndex * limit;
	const setLimit = (nextLimit: number) => {
		setLimitState(nextLimit);
		setPageIndex(0);
	};
	const query = useQuery({
		queryKey: [
			"admin",
			"allowlist",
			siteKey,
			search,
			targetTypeFilter,
			limit,
			offset,
		],
		queryFn: () =>
			listAllowlistRules({
				siteKey,
				targetType: targetTypeFilter === "all" ? undefined : targetTypeFilter,
				search,
				limit,
				offset,
			}),
	});
	const createMutation = useMutation({
		mutationFn: createAllowlistRule,
		onSuccess() {
			setDialogOpen(false);
			setEditingRule(null);
			setForm(buildEmptyAllowlistForm(siteKey));
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const updateMutation = useMutation({
		mutationFn: (input: { ruleId: number; rule: typeof form }) =>
			updateAllowlistRule(input.ruleId, {
				targetType: input.rule.targetType,
				matchMode: input.rule.matchMode,
				scope: input.rule.scope,
				targetValue: input.rule.targetValue,
				reason: input.rule.reason || null,
				expiresAt: fromDatetimeLocalValue(input.rule.expiresAt) ?? null,
			}),
		onSuccess() {
			setDialogOpen(false);
			setEditingRule(null);
			setForm(buildEmptyAllowlistForm(siteKey));
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const deleteMutation = useMutation({
		mutationFn: deleteAllowlistRule,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const openCreate = () => {
		setEditingRule(null);
		setForm(buildEmptyAllowlistForm(siteKey));
		setDialogOpen(true);
	};
	const openEdit = (rule: AdminAllowlistRule) => {
		setEditingRule(rule);
		setForm({
			siteKey,
			global: rule.siteId === null,
			targetType: rule.targetType,
			matchMode: rule.matchMode,
			scope: rule.scope,
			targetValue: rule.targetValue,
			reason: rule.reason ?? "",
			expiresAt: toDatetimeLocalValue(rule.expiresAt),
		});
		setDialogOpen(true);
	};
	const removeRule = async (rule: AdminAllowlistRule) => {
		const confirmed = await confirm({
			title: "删除白名单规则",
			description:
				rule.siteId === null
					? "确认删除这条全局白名单规则？删除后会影响所有站点。"
					: "确认删除这条白名单规则？删除后目标会重新受黑名单和自动拉黑影响。",
			confirmText: "删除规则",
			destructive: true,
		});
		if (confirmed) {
			deleteMutation.mutate(rule.id);
		}
	};
	const updateTargetType = (nextTargetType: TargetType) => {
		setForm((current) => ({
			...current,
			targetType: nextTargetType,
			matchMode: normalizeAllowlistMode(nextTargetType, current.matchMode),
		}));
	};
	const mutationError =
		createMutation.error instanceof Error
			? createMutation.error.message
			: updateMutation.error instanceof Error
				? updateMutation.error.message
				: undefined;

	return (
		<div className="grid gap-3">
			<div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem]">
				<Input
					placeholder="搜索白名单"
					value={search}
					onChange={(event) => {
						setSearch(event.target.value);
						setPageIndex(0);
					}}
				/>
				<select
					className={inputClass}
					value={targetTypeFilter}
					onChange={(event) => {
						setTargetTypeFilter(event.target.value as TargetType | "all");
						setPageIndex(0);
					}}
				>
					<option value="all">全部目标</option>
					<option value="ip">IP</option>
					<option value="email">邮箱</option>
					<option value="visitor">访客</option>
				</select>
				<Button type="button" onClick={openCreate}>
					新增规则
				</Button>
			</div>
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
						<div className="min-w-0">
							<p className="break-all font-medium">{rule.targetValue}</p>
							<p className="text-xs leading-5 text-muted-foreground">
								{labelFor(blacklistTargetTypeLabels, rule.targetType)} /{" "}
								{labelFor(allowlistMatchModeLabels, rule.matchMode)} /{" "}
								{rule.siteId === null ? "全局规则" : "当前站点"} /{" "}
								{labelFor(scopeLabels, rule.scope)} /{" "}
								{formatExpiry(rule.expiresAt)}
								{rule.reason ? ` / ${rule.reason}` : ""}
							</p>
						</div>
						<div className="flex shrink-0 gap-2">
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() => openEdit(rule)}
							>
								编辑
							</Button>
							<Button
								type="button"
								size="sm"
								variant="destructive"
								onClick={() => void removeRule(rule)}
							>
								删除
							</Button>
						</div>
					</div>
				</div>
			))}
			{query.data?.items.length === 0 ? (
				<EmptyState text="暂无白名单规则" />
			) : null}
			<Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
				<Dialog.Content maxWidth="560px">
					<Dialog.Title>
						{editingRule ? "编辑白名单规则" : "新增白名单规则"}
					</Dialog.Title>
					<Dialog.Description size="2">
						白名单只豁免黑名单和自动拉黑，不跳过验证码、页面状态或输入校验。
					</Dialog.Description>
					<form
						className="mt-4 grid gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							if (!form.targetValue.trim()) {
								return;
							}
							if (editingRule) {
								updateMutation.mutate({
									ruleId: editingRule.id,
									rule: form,
								});
								return;
							}
							createMutation.mutate({
								siteKey: form.global ? undefined : form.siteKey,
								targetType: form.targetType,
								matchMode: form.matchMode,
								scope: form.scope,
								targetValue: form.targetValue,
								reason: form.reason || undefined,
								expiresAt: fromDatetimeLocalValue(form.expiresAt),
							});
						}}
					>
						<div className="grid gap-3 md:grid-cols-2">
							<Field label="规则范围">
								<select
									className={inputClass}
									value={form.global ? "global" : "site"}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											global: event.target.value === "global",
										}))
									}
									disabled={Boolean(editingRule)}
								>
									<option value="site">当前站点</option>
									<option value="global">全局</option>
								</select>
							</Field>
							<Field label="作用域">
								<select
									className={inputClass}
									value={form.scope}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											scope: event.target.value as Scope,
										}))
									}
								>
									<option value="post">当前页面</option>
									<option value="all">全局</option>
								</select>
							</Field>
							<Field label="目标类型">
								<select
									className={inputClass}
									value={form.targetType}
									onChange={(event) =>
										updateTargetType(event.target.value as TargetType)
									}
								>
									<option value="ip">IP</option>
									<option value="email">邮箱</option>
									<option value="visitor">访客</option>
								</select>
							</Field>
							<Field label="匹配模式">
								<select
									className={inputClass}
									value={form.matchMode}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											matchMode: event.target.value as AllowlistMatchMode,
										}))
									}
								>
									{allowlistModeOptions[form.targetType].map((mode) => (
										<option key={mode} value={mode}>
											{labelFor(allowlistMatchModeLabels, mode)}
										</option>
									))}
								</select>
							</Field>
						</div>
						<Field label="目标值">
							<Input
								value={form.targetValue}
								onChange={(event) =>
									setForm((current) => ({
										...current,
										targetValue: event.target.value,
									}))
								}
							/>
						</Field>
						<div className="grid gap-3 md:grid-cols-2">
							<Field label="原因">
								<Input
									value={form.reason}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											reason: event.target.value,
										}))
									}
								/>
							</Field>
							<Field label="过期时间">
								<Input
									type="datetime-local"
									value={form.expiresAt}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											expiresAt: event.target.value,
										}))
									}
								/>
							</Field>
						</div>
						{mutationError ? (
							<p className="text-sm font-medium text-destructive">
								{mutationError}
							</p>
						) : null}
						<div className="flex justify-end gap-2">
							<Dialog.Close>
								<Button type="button" variant="outline">
									取消
								</Button>
							</Dialog.Close>
							<Button
								type="submit"
								disabled={createMutation.isPending || updateMutation.isPending}
							>
								{editingRule ? "保存" : "新增规则"}
							</Button>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Root>
		</div>
	);
}
