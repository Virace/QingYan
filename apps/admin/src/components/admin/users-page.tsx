import { useEffect, useState } from "react";
import { Dialog, Tabs } from "@radix-ui/themes";
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
import { Label } from "@/components/ui/label";

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

function toggleSiteKey(
	current: string[],
	siteKey: string,
	checked: boolean,
) {
	return checked
		? Array.from(new Set([...current, siteKey]))
		: current.filter((key) => key !== siteKey);
}

function SiteKeyPicker({
	siteOptions,
	siteKeys,
	onChange,
}: {
	siteOptions: Array<{ siteKey: string; name: string }>;
	siteKeys: string[];
	onChange: (siteKeys: string[]) => void;
}) {
	return (
		<div className="grid gap-2 rounded-md border p-3">
			<p className="text-sm font-medium">站点授权</p>
			{siteOptions.map((site) => (
				<label key={site.siteKey} className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={siteKeys.includes(site.siteKey)}
						onChange={(event) =>
							onChange(toggleSiteKey(siteKeys, site.siteKey, event.target.checked))
						}
					/>
					<span>{site.name}</span>
					<span className="text-xs text-muted-foreground">{site.siteKey}</span>
				</label>
			))}
		</div>
	);
}

export function UsersPage({ isInitialAdmin }: { isInitialAdmin: boolean }) {
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const [createOpen, setCreateOpen] = useState(false);
	const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
	const [resettingUser, setResettingUser] = useState<AdminUser | null>(null);
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [password, setPassword] = useState("");
	const [groupKey, setGroupKey] = useState<AdminGroupKey>("site_admin");
	const [siteKeys, setSiteKeys] = useState<string[]>([]);
	const [passwordChangeRequired, setPasswordChangeRequired] = useState(true);
	const [editDisplayName, setEditDisplayName] = useState("");
	const [editEmail, setEditEmail] = useState("");
	const [editGroupKey, setEditGroupKey] = useState<AdminGroupKey>("site_admin");
	const [editSiteKeys, setEditSiteKeys] = useState<string[]>([]);
	const [editStatus, setEditStatus] = useState<AdminUser["status"]>("active");
	const [editPasswordChangeRequired, setEditPasswordChangeRequired] =
		useState(false);
	const [resetPassword, setResetPassword] = useState("");
	const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
	const [resetPasswordChangeRequired, setResetPasswordChangeRequired] =
		useState(true);
	const [resetError, setResetError] = useState("");
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
			setCreateOpen(false);
			void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
		},
	});
	const updateMutation = useMutation({
		mutationFn: (input: {
			userId: number;
			email?: string;
			status?: AdminUser["status"];
			displayName?: string;
			groupKey?: AdminGroupKey;
			siteKeys?: string[];
			passwordChangeRequired?: boolean;
		}) => updateAdminUser(input.userId, input),
		onSuccess: () => {
			setEditingUser(null);
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const resetMutation = useMutation({
		mutationFn: (input: {
			userId: number;
			password: string;
			passwordChangeRequired: boolean;
		}) =>
			resetAdminUserPassword(input.userId, {
				password: input.password,
				passwordChangeRequired: input.passwordChangeRequired,
			}),
		onSuccess: () => {
			setResettingUser(null);
			setResetPassword("");
			setResetPasswordConfirm("");
			setResetPasswordChangeRequired(true);
			setResetError("");
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
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

	useEffect(() => {
		if (!editingUser) {
			return;
		}
		setEditDisplayName(editingUser.displayName);
		setEditEmail(editingUser.email);
		setEditGroupKey(editingUser.groupKey);
		setEditSiteKeys(editingUser.siteKeys);
		setEditStatus(editingUser.status);
		setEditPasswordChangeRequired(editingUser.passwordChangeRequired);
	}, [editingUser]);

	useEffect(() => {
		if (!resettingUser) {
			return;
		}
		setResetPassword("");
		setResetPasswordConfirm("");
		setResetPasswordChangeRequired(true);
		setResetError("");
	}, [resettingUser]);

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
		<div className="grid gap-4">
			<Tabs.Root defaultValue="users">
				<Tabs.List>
					<Tabs.Trigger value="users">用户</Tabs.Trigger>
					<Tabs.Trigger value="groups">用户组</Tabs.Trigger>
				</Tabs.List>
				<div className="pt-4">
					<Tabs.Content value="users">
						<Card>
							<CardHeader>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<div>
										<CardTitle className="text-lg">用户</CardTitle>
										<CardDescription>
											管理后台用户、状态和站点授权。
										</CardDescription>
									</div>
									<Button type="button" onClick={() => setCreateOpen(true)}>
										新增用户
									</Button>
								</div>
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
															user.status === "active"
																? "outline"
																: "destructive"
														}
													>
														{statusLabel(user.status)}
													</Badge>
													<Badge
														variant={
															user.activeSessionCount > 0
																? "secondary"
																: "outline"
														}
													>
														{user.activeSessionCount > 0
															? `在线 ${user.activeSessionCount}`
															: "无在线会话"}
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
													onClick={() => setEditingUser(user)}
												>
													编辑
												</Button>
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
													onClick={() => setResettingUser(user)}
												>
													重置密码
												</Button>
												<Button
													type="button"
													size="sm"
													variant="outline"
													disabled={
														!canManageAdmin ||
														user.activeSessionCount === 0 ||
														revokeMutation.isPending
													}
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
					</Tabs.Content>
					<Tabs.Content value="groups">
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
					</Tabs.Content>
				</div>
			</Tabs.Root>

			<Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
				<Dialog.Content maxWidth="560px">
					<Dialog.Title>新增用户</Dialog.Title>
					<Dialog.Description size="2">
						创建后台用户并分配固定用户组和站点。
					</Dialog.Description>
					<form
						className="mt-4 grid gap-4"
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
						<div className="grid gap-2">
							<Label htmlFor="user-create-username">用户名</Label>
							<Input
								id="user-create-username"
								value={username}
								onChange={(event) => setUsername(event.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="user-create-email">邮箱</Label>
							<Input
								id="user-create-email"
								type="email"
								value={email}
								onChange={(event) => setEmail(event.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="user-create-display-name">昵称</Label>
							<Input
								id="user-create-display-name"
								value={displayName}
								onChange={(event) => setDisplayName(event.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="user-create-password">初始密码</Label>
							<Input
								id="user-create-password"
								type="password"
								value={password}
								onChange={(event) => setPassword(event.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="user-create-group">用户组</Label>
							<select
								id="user-create-group"
								className={inputClass}
								value={groupKey}
								onChange={(event) =>
									setGroupKey(event.target.value as AdminGroupKey)
								}
							>
								{selectableGroups.map((group) => (
									<option key={group.key} value={group.key}>
										{group.label}
									</option>
								))}
							</select>
						</div>
						{groupKey !== "admin" ? (
							<SiteKeyPicker
								siteOptions={siteOptions}
								siteKeys={siteKeys}
								onChange={setSiteKeys}
							/>
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
						<div className="flex justify-end gap-2">
							<Dialog.Close>
								<Button type="button" variant="outline">
									取消
								</Button>
							</Dialog.Close>
							<Button type="submit" disabled={createMutation.isPending}>
								创建用户
							</Button>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Root>

			<Dialog.Root
				open={Boolean(editingUser)}
				onOpenChange={(open) => {
					if (!open) {
						setEditingUser(null);
					}
				}}
			>
				<Dialog.Content maxWidth="560px">
					<Dialog.Title>编辑用户</Dialog.Title>
					<Dialog.Description size="2">
						直接修改后台用户资料、状态和站点授权。
					</Dialog.Description>
					<form
						className="mt-4 grid gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (!editingUser) {
								return;
							}
							updateMutation.mutate({
								userId: editingUser.id,
								displayName: editDisplayName.trim(),
								email: editEmail.trim(),
								groupKey: editGroupKey,
								siteKeys: editGroupKey === "admin" ? [] : editSiteKeys,
								status: editStatus,
								passwordChangeRequired: editPasswordChangeRequired,
							});
						}}
					>
						<div className="grid gap-2">
							<Label htmlFor="user-edit-display-name">昵称</Label>
							<Input
								id="user-edit-display-name"
								value={editDisplayName}
								onChange={(event) => setEditDisplayName(event.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="user-edit-email">邮箱</Label>
							<Input
								id="user-edit-email"
								type="email"
								value={editEmail}
								onChange={(event) => setEditEmail(event.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="user-edit-group">用户组</Label>
							<select
								id="user-edit-group"
								className={inputClass}
								value={editGroupKey}
								onChange={(event) =>
									setEditGroupKey(event.target.value as AdminGroupKey)
								}
							>
								{selectableGroups.map((group) => (
									<option key={group.key} value={group.key}>
										{group.label}
									</option>
								))}
							</select>
						</div>
						{editGroupKey !== "admin" ? (
							<SiteKeyPicker
								siteOptions={siteOptions}
								siteKeys={editSiteKeys}
								onChange={setEditSiteKeys}
							/>
						) : null}
						<div className="grid gap-2">
							<Label htmlFor="user-edit-status">账号状态</Label>
							<select
								id="user-edit-status"
								className={inputClass}
								value={editStatus}
								onChange={(event) =>
									setEditStatus(event.target.value as AdminUser["status"])
								}
							>
								<option value="active">启用</option>
								<option value="disabled">停用</option>
							</select>
						</div>
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={editPasswordChangeRequired}
								onChange={(event) =>
									setEditPasswordChangeRequired(event.target.checked)
								}
							/>
							<span>要求下次登录修改密码</span>
						</label>
						<div className="flex justify-end gap-2">
							<Dialog.Close>
								<Button type="button" variant="outline">
									取消
								</Button>
							</Dialog.Close>
							<Button type="submit" disabled={updateMutation.isPending}>
								保存用户
							</Button>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Root>

			<Dialog.Root
				open={Boolean(resettingUser)}
				onOpenChange={(open) => {
					if (!open) {
						setResettingUser(null);
					}
				}}
			>
				<Dialog.Content maxWidth="480px">
					<Dialog.Title>重置密码</Dialog.Title>
					<Dialog.Description size="2">
						为 {resettingUser?.username ?? "用户"} 设置新密码。
					</Dialog.Description>
					<form
						className="mt-4 grid gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (!resettingUser) {
								return;
							}
							if (resetPassword !== resetPasswordConfirm) {
								setResetError("两次输入的新密码不一致。");
								return;
							}
							setResetError("");
							resetMutation.mutate({
								userId: resettingUser.id,
								password: resetPassword,
								passwordChangeRequired: resetPasswordChangeRequired,
							});
						}}
					>
						{resetError ? (
							<p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
								{resetError}
							</p>
						) : null}
						<div className="grid gap-2">
							<Label htmlFor="user-reset-password">新密码</Label>
							<Input
								id="user-reset-password"
								type="password"
								value={resetPassword}
								onChange={(event) => setResetPassword(event.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="user-reset-password-confirm">确认新密码</Label>
							<Input
								id="user-reset-password-confirm"
								type="password"
								value={resetPasswordConfirm}
								onChange={(event) =>
									setResetPasswordConfirm(event.target.value)
								}
							/>
						</div>
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={resetPasswordChangeRequired}
								onChange={(event) =>
									setResetPasswordChangeRequired(event.target.checked)
								}
							/>
							<span>要求下次登录修改密码</span>
						</label>
						<div className="flex justify-end gap-2">
							<Dialog.Close>
								<Button type="button" variant="outline">
									取消
								</Button>
							</Dialog.Close>
							<Button type="submit" disabled={resetMutation.isPending}>
								重置密码
							</Button>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Root>
		</div>
	);
}
