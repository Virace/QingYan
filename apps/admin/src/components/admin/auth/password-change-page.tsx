import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon } from "lucide-react";

import { adminUiErrorMessage } from "@/api/client";
import {
	confirmAdminProfilePasswordChange,
	updateAdminProfilePassword,
} from "@/api/profile";
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

import { AdminErrorAlert } from "../shared/admin-error-alert";

export function PasswordChangePage({ onChanged }: { onChanged: () => void }) {
	const queryClient = useQueryClient();
	const [currentPassword, setCurrentPassword] = useState("");
	const [nextPassword, setNextPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [verificationCode, setVerificationCode] = useState("");
	const [pendingExpiresAt, setPendingExpiresAt] = useState("");
	const [message, setMessage] = useState("");
	const mutation = useMutation({
		mutationFn: updateAdminProfilePassword,
		onSuccess(payload) {
			setMessage("");
			if ("status" in payload) {
				setVerificationCode("");
				setPendingExpiresAt(payload.expiresAt);
				return;
			}
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
			onChanged();
		},
		onError(error) {
			setMessage(adminUiErrorMessage(error, "密码修改失败。"));
		},
	});
	const confirmMutation = useMutation({
		mutationFn: confirmAdminProfilePasswordChange,
		onSuccess() {
			setMessage("");
			setCurrentPassword("");
			setNextPassword("");
			setConfirmPassword("");
			setVerificationCode("");
			setPendingExpiresAt("");
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
			onChanged();
		},
		onError(error) {
			setMessage(adminUiErrorMessage(error, "密码确认失败。"));
		},
	});

	return (
		<main className="flex min-h-dvh items-center justify-center bg-muted/40 p-6">
			<Card className="w-full max-w-[420px]">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<KeyRoundIcon data-icon="inline-start" />
						修改密码
					</CardTitle>
					<CardDescription>当前账号需要先更新登录密码。</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="grid gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							mutation.mutate({
								currentPassword,
								nextPassword,
								confirmPassword,
							});
						}}
					>
						{message ? (
							<AdminErrorAlert
								error={message}
								title="修改失败"
								fallback="密码修改失败。"
							/>
						) : null}
						<div className="grid gap-2">
							<Label htmlFor="current-password">当前密码</Label>
							<Input
								id="current-password"
								type="password"
								autoComplete="current-password"
								value={currentPassword}
								onChange={(event) => setCurrentPassword(event.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="next-password">新密码</Label>
							<Input
								id="next-password"
								type="password"
								autoComplete="new-password"
								value={nextPassword}
								onChange={(event) => setNextPassword(event.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="confirm-password">确认新密码</Label>
							<Input
								id="confirm-password"
								type="password"
								autoComplete="new-password"
								value={confirmPassword}
								onChange={(event) => setConfirmPassword(event.target.value)}
							/>
						</div>
						<Button type="submit" disabled={mutation.isPending}>
							{mutation.isPending ? "保存中" : "保存密码"}
						</Button>
					</form>
					{pendingExpiresAt ? (
						<form
							className="mt-4 grid gap-3 rounded-md border bg-muted/20 p-3"
							onSubmit={(event) => {
								event.preventDefault();
								confirmMutation.mutate({ token: verificationCode.trim() });
							}}
						>
							<p className="text-sm text-muted-foreground">
								验证码已发送到当前账号邮箱，有效期至{" "}
								{new Date(pendingExpiresAt).toLocaleString()}。
							</p>
							<div className="grid gap-2">
								<Label htmlFor="password-token">密码验证码</Label>
								<Input
									id="password-token"
									inputMode="numeric"
									autoComplete="one-time-code"
									value={verificationCode}
									onChange={(event) => setVerificationCode(event.target.value)}
								/>
							</div>
							<Button
								type="submit"
								variant="outline"
								disabled={confirmMutation.isPending}
							>
								确认密码变更
							</Button>
						</form>
					) : null}
				</CardContent>
			</Card>
		</main>
	);
}
