import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon } from "lucide-react";

import { updateAdminProfilePassword } from "@/api/profile";
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

export function PasswordChangePage({ onChanged }: { onChanged: () => void }) {
	const queryClient = useQueryClient();
	const [currentPassword, setCurrentPassword] = useState("");
	const [nextPassword, setNextPassword] = useState("");
	const [message, setMessage] = useState("");
	const mutation = useMutation({
		mutationFn: updateAdminProfilePassword,
		onSuccess() {
			setMessage("");
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
			onChanged();
		},
		onError(error) {
			setMessage(error instanceof Error ? error.message : "密码修改失败。");
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
						<Button type="submit" disabled={mutation.isPending}>
							{mutation.isPending ? "保存中" : "保存密码"}
						</Button>
					</form>
				</CardContent>
			</Card>
		</main>
	);
}
