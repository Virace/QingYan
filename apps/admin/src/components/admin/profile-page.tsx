import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, MailIcon, SaveIcon, UserRoundIcon } from "lucide-react";

import {
	confirmAdminProfileEmailChange,
	fetchAdminProfile,
	requestAdminProfileEmailChange,
	updateAdminProfile,
	updateAdminProfilePassword,
} from "@/api/profile";
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

import { AdminErrorAlert } from "./admin-error-alert";
import { EmptyState, StatTile } from "./admin-ui";

function formatDateTime(value?: string) {
	if (!value) {
		return "未知";
	}
	return new Date(value).toLocaleString();
}

export function ProfilePage() {
	const queryClient = useQueryClient();
	const [displayName, setDisplayName] = useState("");
	const [website, setWebsite] = useState("");
	const [avatarUrl, setAvatarUrl] = useState("");
	const [currentPassword, setCurrentPassword] = useState("");
	const [nextPassword, setNextPassword] = useState("");
	const [email, setEmail] = useState("");
	const [emailPassword, setEmailPassword] = useState("");
	const [verificationToken, setVerificationToken] = useState("");
	const [profileMessage, setProfileMessage] = useState("");
	const [passwordMessage, setPasswordMessage] = useState("");
	const [emailMessage, setEmailMessage] = useState("");
	const profileQuery = useQuery({
		queryKey: ["admin", "profile"],
		queryFn: fetchAdminProfile,
	});
	const profile = profileQuery.data;
	const pendingToken = verificationToken.trim();

	useEffect(() => {
		if (!profile) {
			return;
		}
		setDisplayName(profile.user.displayName);
		setWebsite(profile.user.website ?? "");
		setAvatarUrl(profile.user.avatarUrl ?? "");
		setEmail(profile.user.email);
	}, [profile]);

	const updateProfileMutation = useMutation({
		mutationFn: updateAdminProfile,
		onSuccess(payload) {
			setProfileMessage("");
			setDisplayName(payload.user.displayName);
			setWebsite(payload.user.website ?? "");
			setAvatarUrl(payload.user.avatarUrl ?? "");
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
		onError(error) {
			setProfileMessage(
				error instanceof Error ? error.message : "个人资料保存失败。",
			);
		},
	});
	const updatePasswordMutation = useMutation({
		mutationFn: updateAdminProfilePassword,
		onSuccess() {
			setPasswordMessage("");
			setCurrentPassword("");
			setNextPassword("");
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
		onError(error) {
			setPasswordMessage(
				error instanceof Error ? error.message : "密码修改失败。",
			);
		},
	});
	const emailChangeMutation = useMutation({
		mutationFn: requestAdminProfileEmailChange,
		onSuccess(payload) {
			setEmailMessage("");
			setEmailPassword("");
			if (payload.status === "pending_verification") {
				setVerificationToken(payload.verificationToken ?? "");
				return;
			}
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
		onError(error) {
			setEmailMessage(
				error instanceof Error ? error.message : "邮箱修改失败。",
			);
		},
	});
	const confirmEmailMutation = useMutation({
		mutationFn: confirmAdminProfileEmailChange,
		onSuccess(payload) {
			setEmailMessage("");
			setVerificationToken("");
			setEmail(payload.user.email);
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
			void queryClient.invalidateQueries({ queryKey: ["admin", "profile"] });
		},
		onError(error) {
			setEmailMessage(
				error instanceof Error ? error.message : "邮箱确认失败。",
			);
		},
	});

	if (profileQuery.isLoading) {
		return <EmptyState text="正在载入个人资料" />;
	}

	if (!profile) {
		return <EmptyState text="个人资料暂不可用" />;
	}

	return (
		<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
			<div className="grid gap-4">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-lg">
							<UserRoundIcon data-icon="inline-start" />
							个人资料
						</CardTitle>
						<CardDescription>更新当前后台账号的展示信息。</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							className="grid gap-4"
							onSubmit={(event) => {
								event.preventDefault();
								updateProfileMutation.mutate({
									displayName: displayName.trim(),
									website: website.trim(),
									avatarUrl: avatarUrl.trim(),
								});
							}}
						>
							{profileMessage ? (
								<AdminErrorAlert
									error={profileMessage}
									title="保存失败"
									fallback="个人资料保存失败。"
								/>
							) : null}
							<div className="grid gap-2">
								<Label htmlFor="profile-display-name">昵称</Label>
								<Input
									id="profile-display-name"
									value={displayName}
									onChange={(event) => setDisplayName(event.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="profile-website">网站</Label>
								<Input
									id="profile-website"
									type="url"
									value={website}
									onChange={(event) => setWebsite(event.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="profile-avatar">头像 URL</Label>
								<Input
									id="profile-avatar"
									type="url"
									value={avatarUrl}
									onChange={(event) => setAvatarUrl(event.target.value)}
								/>
							</div>
							<Button type="submit" disabled={updateProfileMutation.isPending}>
								<SaveIcon data-icon="inline-start" />
								保存资料
							</Button>
						</form>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-lg">
							<MailIcon data-icon="inline-start" />
							邮箱
						</CardTitle>
						<CardDescription>邮箱变更会校验唯一性。</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-4">
						<form
							className="grid gap-4"
							onSubmit={(event) => {
								event.preventDefault();
								emailChangeMutation.mutate({
									newEmail: email.trim(),
									currentPassword: emailPassword || undefined,
								});
							}}
						>
							{emailMessage ? (
								<AdminErrorAlert
									error={emailMessage}
									title="邮箱操作失败"
									fallback="邮箱操作失败。"
								/>
							) : null}
							<div className="grid gap-2">
								<Label htmlFor="profile-email">邮箱</Label>
								<Input
									id="profile-email"
									type="email"
									autoComplete="email"
									value={email}
									onChange={(event) => setEmail(event.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="profile-email-password">当前密码</Label>
								<Input
									id="profile-email-password"
									type="password"
									autoComplete="current-password"
									value={emailPassword}
									onChange={(event) => setEmailPassword(event.target.value)}
								/>
							</div>
							<Button type="submit" disabled={emailChangeMutation.isPending}>
								<MailIcon data-icon="inline-start" />
								提交邮箱变更
							</Button>
						</form>
						{pendingToken ? (
							<form
								className="grid gap-3 rounded-md border bg-muted/20 p-3"
								onSubmit={(event) => {
									event.preventDefault();
									confirmEmailMutation.mutate({ token: pendingToken });
								}}
							>
								<div className="grid gap-2">
									<Label htmlFor="profile-email-token">验证令牌</Label>
									<Input
										id="profile-email-token"
										value={verificationToken}
										onChange={(event) =>
											setVerificationToken(event.target.value)
										}
									/>
								</div>
								<Button
									type="submit"
									variant="outline"
									disabled={confirmEmailMutation.isPending}
								>
									确认邮箱
								</Button>
							</form>
						) : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-lg">
							<KeyRoundIcon data-icon="inline-start" />
							密码
						</CardTitle>
						<CardDescription>修改当前后台账号的登录密码。</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							className="grid gap-4"
							onSubmit={(event) => {
								event.preventDefault();
								updatePasswordMutation.mutate({
									currentPassword,
									nextPassword,
								});
							}}
						>
							{passwordMessage ? (
								<AdminErrorAlert
									error={passwordMessage}
									title="修改失败"
									fallback="密码修改失败。"
								/>
							) : null}
							<div className="grid gap-2">
								<Label htmlFor="profile-current-password">当前密码</Label>
								<Input
									id="profile-current-password"
									type="password"
									autoComplete="current-password"
									value={currentPassword}
									onChange={(event) => setCurrentPassword(event.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="profile-next-password">新密码</Label>
								<Input
									id="profile-next-password"
									type="password"
									autoComplete="new-password"
									value={nextPassword}
									onChange={(event) => setNextPassword(event.target.value)}
								/>
							</div>
							<Button type="submit" disabled={updatePasswordMutation.isPending}>
								<KeyRoundIcon data-icon="inline-start" />
								保存密码
							</Button>
						</form>
					</CardContent>
				</Card>
			</div>

			<Card className="h-fit">
				<CardHeader>
					<CardTitle className="text-lg">{profile.user.displayName}</CardTitle>
					<CardDescription>{profile.user.username}</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3">
					<StatTile label="邮箱" value={profile.user.email} />
					<StatTile
						label="用户组"
						value={
							<span className="inline-flex items-center gap-2">
								{profile.user.groupName}
								<Badge variant="outline">{profile.user.groupKey}</Badge>
							</span>
						}
					/>
					<StatTile
						label="可访问站点"
						value={
							profile.user.groupKey === "admin"
								? "全部站点"
								: profile.sites.length
									? profile.sites.join(", ")
									: "未授权站点"
						}
					/>
					<StatTile
						label="会话过期"
						value={formatDateTime(profile.session.expiresAt)}
					/>
					<StatTile
						label="账号状态"
						value={profile.user.passwordChangeRequired ? "需修改密码" : "正常"}
					/>
				</CardContent>
			</Card>
		</div>
	);
}
