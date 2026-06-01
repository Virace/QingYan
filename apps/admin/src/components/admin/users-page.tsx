import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	createAdminUser,
	deleteAdminUser,
	listAdminGroups,
	listAdminUsers,
	listSites,
	resetAdminUserPassword,
	revokeAdminUserSessions,
	updateAdminUser,
	type AdminGroupKey,
	type AdminUser,
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

import { EmptyState, inputClass } from "./admin-ui";
import { useAdminConfirmDialog } from "./confirm-dialog";

const groupOptions: Array<{ key: AdminGroupKey; label: string }> = [
	{ key: "site_admin", label: "站点管理员" },
	{ key: "site_moderator", label: "站点评论管理员" },
	{ key: "admin", label: "管理员" },
];

function groupLabel(groupKey: AdminGroupKey) {
	return (
		groupOptions.find((group) => group.key === groupKey)?.label ?? groupKey
	);
}

function statusLabel(status: AdminUser["status"]) {
	if (status === "active") {
		return "启用";
	}
	if (status === "disabled") {
		return "停用";
	}
	return "已删除";
}

export function UsersPage({ isInitialAdmin }: { isInitialAdmin: boolean }) {
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [password, setPassword] = useState("");
	const [groupKey, setGroupKey] = useState<AdminGroupKey>("site_admin");
	const [siteKeys, setSiteKeys] = useState<string[]>([]);
	const [passwordChangeRequired, setPasswordChangeRequired] = useState(true);
	const usersQuery = useQuery({
		queryKey: ["admin", "users"],
		queryFn: () => listAdminUsers(),
	});
	const groupsQuery = useQuery({
		queryKey: ["admin", "groups"],
		queryFn: listAdminGroups,
	});
	const sitesQuery = useQuery({
		queryKey: ["admin", "sites"],
		queryFn: listSites,
	});
	const createMutation = useMutation({
		mutationFn: createAdminUser,
		onSuccess: () => {
			setUsername("");
			setEmail("");
			setDisplayName("");
			setPassword("");
			setGroupKey("site_admin");
			setSiteKeys([]);
			setPasswordChangeRequired(true);
			void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
		},
	});
	const updateMutation = useMutation({
		mutationFn: (input: {
			userId: number;
			status?: AdminUser["status"];
			displayName?: string;
			groupKey?: AdminGroupKey;
			siteKeys?: string[];
		}) => updateAdminUser(input.userId, input),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const resetMutation = useMutation({
		mutationFn: (input: { userId: number; password: string }) =>
			resetAdminUserPassword(input.userId, {
				password: input.password,
				passwordChangeRequired: true,
			}),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const revokeMutation = useMutation({
		mutationFn: (input: {
			userId: number;
			loginBlockPreset: "none" | "1h" | "1d" | "7d" | "custom";
			reason?: string;
		}) => revokeAdminUserSessions(input.userId, input),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const deleteMutation = useMutation({
		mutationFn: deleteAdminUser,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});

	const selectableGroups = groupOptions.filter(
		(group) => group.key !== "admin" || isInitialAdmin,
	);
	const siteOptions = sitesQuery.data?.items ?? [];
	const revokeUserSessions = async (user: AdminUser) => {
		const confirmed = await confirm({
			title: "强制登出用户",
			description: `确认强制登出 ${user.username} 的所有会话，并临时禁止登录 1 小时？`,
			confirmText: "强制登出",
			destructive: true,
		});
		if (!confirmed) {
			return;
		}
		revokeMutation.mutate({
			userId: user.id,
			loginBlockPreset: "1h",
			reason: "admin console",
		});
	};
	const deleteUser = async (user: AdminUser) => {
		const confirmed = await confirm({
			title: "删除后台用户",
			description: `确认删除用户 ${user.username}？该用户将无法继续登录，历史操作记录仍会保留。`,
			confirmText: "删除用户",
			destructive: true,
		});
		if (!confirmed) {
			return;
		}
		deleteMutation.mutate(user.id);
	};

	return (
		<div className="grid gap-4 xl:grid-cols-[380px_1fr]">
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">新增用户</CardTitle>
					<CardDescription>
						创建后台用户并分配固定用户组和站点。
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="grid gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							createMutation.mutate({
								username: username.trim(),
								email: email.trim(),
								displayName: displayName.trim(),
								password,
								groupKey,
								siteKeys: groupKey === "admin" ? [] : siteKeys,
								passwordChangeRequired,
							});
						}}
					>
						<Input
							placeholder="用户名"
							value={username}
							onChange={(event) => setUsername(event.target.value)}
						/>
						<Input
							placeholder="邮箱"
							type="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
						/>
						<Input
							placeholder="昵称"
							value={displayName}
							onChange={(event) => setDisplayName(event.target.value)}
						/>
						<Input
							placeholder="初始密码"
							type="password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
						/>
						<select
							className={inputClass}
							value={groupKey}
							onChange={(event) =>
								setGroupKey(event.target.value as AdminGroupKey)
							}
							aria-label="用户组"
						>
							{selectableGroups.map((group) => (
								<option key={group.key} value={group.key}>
									{group.label}
								</option>
							))}
						</select>
						{groupKey !== "admin" ? (
							<div className="grid gap-2 rounded-md border p-3">
								<p className="text-sm font-medium">站点授权</p>
								{siteOptions.map((site) => (
									<label
										key={site.siteKey}
										className="flex items-center gap-2 text-sm"
									>
										<input
											type="checkbox"
											checked={siteKeys.includes(site.siteKey)}
											onChange={(event) => {
												setSiteKeys((current) =>
													event.target.checked
														? [...current, site.siteKey]
														: current.filter((key) => key !== site.siteKey),
												);
											}}
										/>
										<span>{site.name}</span>
										<span className="text-xs text-muted-foreground">
											{site.siteKey}
										</span>
									</label>
								))}
							</div>
						) : null}
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={passwordChangeRequired}
								onChange={(event) =>
									setPasswordChangeRequired(event.target.checked)
								}
							/>
							<span>要求下次登录修改密码</span>
						</label>
						<Button type="submit" disabled={createMutation.isPending}>
							创建用户
						</Button>
					</form>
				</CardContent>
			</Card>
			<div className="grid gap-4">
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">用户</CardTitle>
						<CardDescription>管理后台用户、状态和站点授权。</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-3">
						{usersQuery.data?.users.map((user) => {
							const canManageAdmin =
								user.groupKey !== "admin" ||
								(isInitialAdmin && !user.isInitialAdmin);
							const nextStatus =
								user.status === "active" ? "disabled" : "active";
							return (
								<div
									key={user.id}
									className="grid gap-3 rounded-md border p-4 lg:grid-cols-[1fr_auto]"
								>
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2">
											<p className="font-medium">{user.displayName}</p>
											<Badge variant="secondary">
												{groupLabel(user.groupKey)}
											</Badge>
											<Badge
												variant={
													user.status === "active" ? "outline" : "destructive"
												}
											>
												{statusLabel(user.status)}
											</Badge>
											{user.isInitialAdmin ? (
												<Badge variant="outline">初始管理员</Badge>
											) : null}
											{user.passwordChangeRequired ? (
												<Badge variant="outline">需改密</Badge>
											) : null}
										</div>
										<p className="mt-1 text-sm text-muted-foreground">
											{user.username} / {user.email}
										</p>
										<div className="mt-2 flex flex-wrap gap-2">
											{user.groupKey === "admin" ? (
												<Badge variant="outline">全部站点</Badge>
											) : user.siteKeys.length > 0 ? (
												user.siteKeys.map((siteKey) => (
													<Badge key={siteKey} variant="outline">
														{siteKey}
													</Badge>
												))
											) : (
												<Badge variant="outline">未授权站点</Badge>
											)}
										</div>
									</div>
									<div className="flex flex-wrap items-start gap-2 lg:justify-end">
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={!canManageAdmin || updateMutation.isPending}
											onClick={() =>
												updateMutation.mutate({
													userId: user.id,
													status: nextStatus,
												})
											}
										>
											{nextStatus === "disabled" ? "停用" : "启用"}
										</Button>
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={!canManageAdmin || resetMutation.isPending}
											onClick={() => {
												const nextPassword = window.prompt(
													`重置 ${user.username} 的密码`,
												);
												if (nextPassword) {
													resetMutation.mutate({
														userId: user.id,
														password: nextPassword,
													});
												}
											}}
										>
											重置密码
										</Button>
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={!canManageAdmin || revokeMutation.isPending}
											onClick={() => void revokeUserSessions(user)}
										>
											强制登出
										</Button>
										<Button
											type="button"
											size="sm"
											variant="destructive"
											disabled={
												!canManageAdmin ||
												user.isInitialAdmin ||
												deleteMutation.isPending
											}
											onClick={() => void deleteUser(user)}
										>
											删除
										</Button>
									</div>
								</div>
							);
						})}
						{usersQuery.data?.users.length === 0 ? (
							<EmptyState text="暂无用户" />
						) : null}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">用户组</CardTitle>
						<CardDescription>固定用户组只读展示。</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-3 md:grid-cols-3">
						{groupsQuery.data?.groups.map((group) => (
							<div key={group.key} className="rounded-md border p-4">
								<p className="font-medium">{group.name}</p>
								<p className="mt-1 text-xs text-muted-foreground">
									{group.description}
								</p>
								<p className="mt-3 text-xs text-muted-foreground">
									权限 {group.permissions.length}
								</p>
							</div>
						))}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
