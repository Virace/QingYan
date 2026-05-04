import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";

import { ApiError } from "@/api/client";
import {
	fetchAdminCaptcha,
	loginAdmin,
	type CaptchaChallenge,
} from "@/api/session";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

export function LoginPage({ onLogin }: { onLogin: () => void }) {
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [captchaValue, setCaptchaValue] = useState("");
	const [challenge, setChallenge] = useState<CaptchaChallenge | null>(null);
	const [message, setMessage] = useState("");

	const captchaQuery = useQuery({
		queryKey: ["admin", "captcha"],
		queryFn: fetchAdminCaptcha,
	});
	const loginMutation = useMutation({
		mutationFn: loginAdmin,
		onSuccess() {
			setMessage("");
			setCaptchaValue("");
			onLogin();
		},
		onError(error) {
			const text = error instanceof Error ? error.message : "管理员登录失败。";
			setMessage(text);
			if (!(error instanceof ApiError) || error.code !== "ADMIN_BLACKLISTED") {
				void captchaQuery.refetch();
			}
		},
	});

	useEffect(() => {
		if (captchaQuery.data?.challenge) {
			setChallenge(captchaQuery.data.challenge);
		}
	}, [captchaQuery.data]);

	function submitLogin(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!username.trim() || !password.trim() || !captchaValue.trim()) {
			setMessage("请填写用户名、密码和验证码。");
			return;
		}

		loginMutation.mutate({
			username,
			password,
			challengeId: challenge?.challengeId,
			captchaValue,
		});
	}

	return (
		<main className="flex min-h-dvh items-center justify-center bg-muted/40 p-6">
			<Card className="w-full max-w-[420px]">
				<CardHeader>
					<CardTitle>QingYan Admin</CardTitle>
					<CardDescription>
						管理员登录需要验证码，连续错误会触发 IP 封禁。
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="flex flex-col gap-4" onSubmit={submitLogin}>
						{message ? (
							<Alert variant="destructive">
								<AlertTitle>登录失败</AlertTitle>
								<AlertDescription>{message}</AlertDescription>
							</Alert>
						) : null}
						<div className="flex flex-col gap-2">
							<Label htmlFor="admin-username">用户名</Label>
							<Input
								id="admin-username"
								autoComplete="username"
								value={username}
								onChange={(event) => setUsername(event.target.value)}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="admin-password">密码</Label>
							<Input
								id="admin-password"
								type="password"
								autoComplete="current-password"
								value={password}
								onChange={(event) => setPassword(event.target.value)}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="admin-captcha">验证码</Label>
							<div className="flex items-center gap-3">
								<div className="flex h-[60px] w-[160px] items-center justify-center overflow-hidden rounded-md border bg-background">
									{challenge?.imageData ? (
										<img
											src={challenge.imageData}
											alt="管理员登录验证码"
											className="h-full w-full object-cover"
										/>
									) : (
										<span className="text-sm text-muted-foreground">
											加载中
										</span>
									)}
								</div>
								<Button
									type="button"
									variant="outline"
									size="icon"
									onClick={() => captchaQuery.refetch()}
									disabled={captchaQuery.isFetching}
									aria-label="刷新验证码"
								>
									<RefreshCwIcon data-icon="inline-start" />
								</Button>
							</div>
							<Input
								id="admin-captcha"
								inputMode="numeric"
								value={captchaValue}
								onChange={(event) => setCaptchaValue(event.target.value)}
							/>
						</div>
						<Button type="submit" disabled={loginMutation.isPending}>
							{loginMutation.isPending ? "登录中" : "登录后台"}
						</Button>
					</form>
				</CardContent>
			</Card>
		</main>
	);
}
