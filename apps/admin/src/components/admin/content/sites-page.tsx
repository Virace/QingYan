import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "@radix-ui/themes";
import { useState } from "react";

import { createSite, listSites, updateSite } from "@/api/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { AdminView } from "../shell/admin-shell";
import { ExternalLinkText } from "../shared/external-link-text";

export function SitesPage({
	openSite,
}: {
	openSite: (siteKey: string, view: AdminView) => void;
}) {
	const queryClient = useQueryClient();
	const [createOpen, setCreateOpen] = useState(false);
	const [siteKey, setSiteKey] = useState("");
	const [name, setName] = useState("");
	const [origin, setOrigin] = useState("");
	const query = useQuery({
		queryKey: ["admin", "sites"],
		queryFn: listSites,
	});
	const createMutation = useMutation({
		mutationFn: createSite,
		onSuccess: () => {
			setSiteKey("");
			setName("");
			setOrigin("");
			setCreateOpen(false);
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const updateMutation = useMutation({
		mutationFn: (input: {
			siteKey: string;
			name: string;
			allowedOrigins: string[];
		}) =>
			updateSite(input.siteKey, {
				name: input.name,
				allowedOrigins: input.allowedOrigins,
			}),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const allowedOrigin = origin.trim();

	return (
		<div className="grid gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-lg font-semibold">站点</h2>
					<p className="text-sm text-muted-foreground">
						配置站点和站点设置摘要。
					</p>
				</div>
				<Button type="button" onClick={() => setCreateOpen(true)}>
					新增站点
				</Button>
			</div>
			<Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
				<Dialog.Content maxWidth="520px">
					<Dialog.Title>新增站点</Dialog.Title>
					<Dialog.Description size="2">
						创建站点后可继续配置站点设置。
					</Dialog.Description>
					<form
						className="mt-4 grid gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (!siteKey.trim() || !name.trim() || !allowedOrigin) {
								return;
							}
							createMutation.mutate({
								siteKey: siteKey.trim(),
								name: name.trim(),
								allowedOrigins: [allowedOrigin],
							});
						}}
					>
						<div className="grid gap-2">
							<Label htmlFor="site-create-key">站点 key</Label>
							<Input
								id="site-create-key"
								value={siteKey}
								onChange={(event) => setSiteKey(event.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="site-create-name">站点名称</Label>
							<Input
								id="site-create-name"
								value={name}
								onChange={(event) => setName(event.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="site-create-origin">前端站点 Origin</Label>
							<Input
								id="site-create-origin"
								value={origin}
								onChange={(event) => setOrigin(event.target.value)}
							/>
						</div>
						<div className="flex justify-end gap-2">
							<Dialog.Close>
								<Button type="button" variant="outline">
									取消
								</Button>
							</Dialog.Close>
							<Button type="submit" disabled={createMutation.isPending}>
								创建站点
							</Button>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Root>
			<div className="grid gap-3 md:grid-cols-2">
				{query.data?.items.map((site) => {
					const draftOrigin = site.allowedOrigins[0] ?? "";
					return (
						<div key={site.siteKey} className="rounded-md border p-4">
							<p className="font-medium">{site.name}</p>
							<p className="text-xs text-muted-foreground">{site.siteKey}</p>
							<form
								className="mt-3 grid gap-2"
								onSubmit={(event) => {
									event.preventDefault();
									const form = new FormData(event.currentTarget);
									const nextName = String(form.get("name") ?? "").trim();
									const nextOrigin = String(form.get("origin") ?? "").trim();
									if (!nextName || !nextOrigin) {
										return;
									}
									updateMutation.mutate({
										siteKey: site.siteKey,
										name: nextName,
										allowedOrigins: [nextOrigin],
									});
								}}
							>
								<Input name="name" defaultValue={site.name} />
								<Input name="origin" defaultValue={draftOrigin} />
								<Button
									type="submit"
									size="sm"
									variant="outline"
									disabled={updateMutation.isPending}
								>
									保存站点
								</Button>
							</form>
							<div className="mt-3 flex flex-wrap gap-2">
								<Badge variant="secondary">页面 {site.pageCount}</Badge>
								<Badge variant="outline">评论 {site.commentCount}</Badge>
								<Badge variant="outline">评论者 {site.commenterCount}</Badge>
								<Badge variant="outline">访客 {site.visitorCount}</Badge>
							</div>
							<div className="mt-3 text-xs">
								<ExternalLinkText href={draftOrigin}>
									{draftOrigin || "-"}
								</ExternalLinkText>
							</div>
							<div className="mt-4 flex flex-wrap gap-2">
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={() => openSite(site.siteKey, "settings")}
								>
									站点设置
								</Button>
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={() => openSite(site.siteKey, "pages")}
								>
									页面
								</Button>
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={() => openSite(site.siteKey, "commenters")}
								>
									评论者
								</Button>
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={() => openSite(site.siteKey, "visitors")}
								>
									访客
								</Button>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
