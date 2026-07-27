import { DropdownMenu } from "@radix-ui/themes";
import { useState } from "react";

import type {
	AdminUser,
	NotificationChannelConfig,
	SiteNotificationEventSettings,
} from "@/api/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const eventCopy = {
	admin_comment_pending: {
		title: "新待审评论",
		description: "新评论进入待审核列表时通知所选站点人员。",
	},
	admin_comment_approved: {
		title: "直接发布评论",
		description: "新评论无需审核并直接发布时通知所选站点人员。",
	},
} as const;

function recipientLabel(user: {
	displayName: string;
	username: string;
	email: string;
}) {
	return user.displayName || user.username || user.email;
}

export function SiteNotificationEventPanel({
	event,
	eligibleUsers,
	externalChannelConfigs,
	disabled,
	onRecipientUserIdsChange,
	onExternalChannelConfigIdsChange,
}: {
	event: SiteNotificationEventSettings;
	eligibleUsers: AdminUser[];
	externalChannelConfigs: NotificationChannelConfig[];
	disabled?: boolean;
	onRecipientUserIdsChange: (userIds: number[]) => void;
	onExternalChannelConfigIdsChange: (configIds: string[]) => void;
}) {
	const [userSearch, setUserSearch] = useState("");
	const copy = eventCopy[event.eventType];
	const selectedUserIds = new Set(
		event.recipients.map((recipient) => recipient.userId),
	);
	const selectedExternalIds = new Set(event.externalChannelConfigIds);
	const recipientCount = event.recipients.length;
	const targetCount = recipientCount + event.externalChannelConfigIds.length;
	const unavailableTargetCount = event.externalChannelConfigIds.filter(
		(configId) =>
			!externalChannelConfigs.some(
				(config) => config.id === configId && config.enabled,
			),
	).length;
	const normalizedSearch = userSearch.trim().toLowerCase();
	const visibleUsers = normalizedSearch
		? eligibleUsers.filter((user) =>
				[user.displayName, user.username, user.email].some((value) =>
					value.toLowerCase().includes(normalizedSearch),
				),
			)
		: eligibleUsers;

	return (
		<div className="grid min-w-0 gap-4 rounded-md border bg-background p-4">
			<div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h4 className="font-medium">{copy.title}</h4>
					<p className="mt-1 max-w-[64ch] text-sm leading-6 text-muted-foreground">
						{copy.description}
					</p>
				</div>
				<Badge
					className="shrink-0 whitespace-nowrap"
					variant={targetCount > 0 ? "secondary" : "outline"}
				>
					{targetCount > 0
						? `会发送给 ${targetCount} 个目标`
						: "未选择接收人，不会发送"}
				</Badge>
			</div>

			<div className="grid gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							<Button type="button" variant="outline" disabled={disabled}>
								选择站点人员
							</Button>
						</DropdownMenu.Trigger>
						<DropdownMenu.Content
							align="start"
							className="max-h-72 min-w-72 overflow-y-auto"
						>
							<div className="sticky top-0 z-10 bg-popover p-1">
								<Input
									value={userSearch}
									placeholder="搜索姓名、账号或邮箱"
									aria-label="搜索站点人员"
									onKeyDown={(event) => event.stopPropagation()}
									onChange={(event) => setUserSearch(event.target.value)}
								/>
							</div>
							{visibleUsers.length > 0 ? (
								visibleUsers.map((user) => (
									<DropdownMenu.CheckboxItem
										key={user.id}
										checked={selectedUserIds.has(user.id)}
										onSelect={(selectEvent) => selectEvent.preventDefault()}
										onCheckedChange={(checked) => {
											const next = new Set(selectedUserIds);
											if (checked) {
												next.add(user.id);
											} else {
												next.delete(user.id);
											}
											onRecipientUserIdsChange(Array.from(next));
										}}
									>
										<span className="grid min-w-0">
											<span>{recipientLabel(user)}</span>
											<span className="text-xs text-muted-foreground">
												{user.email}
											</span>
										</span>
									</DropdownMenu.CheckboxItem>
								))
							) : (
								<DropdownMenu.Item disabled>
									{eligibleUsers.length > 0
										? "没有符合搜索条件的站点人员"
										: "当前没有可选择的站点人员"}
								</DropdownMenu.Item>
							)}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
					<span className="text-xs text-muted-foreground">
						可多选；每种通知类型分别保存。
					</span>
				</div>

				{event.recipients.length > 0 ? (
					<div className="flex flex-wrap gap-2">
						{event.recipients.map((recipient) => (
							<div
								key={recipient.userId}
								className="flex min-w-0 items-center gap-2 rounded-full border bg-muted/30 py-1 pl-3 pr-1 text-sm"
							>
								<span className="max-w-64 truncate">
									{recipientLabel(recipient)}
								</span>
								<Button
									type="button"
									size="sm"
									variant="outline"
									className="h-7 rounded-full px-2"
									disabled={disabled}
									aria-label={`移除${recipientLabel(recipient)}`}
									onClick={() =>
										onRecipientUserIdsChange(
											event.recipients
												.filter((item) => item.userId !== recipient.userId)
												.map((item) => item.userId),
										)
									}
								>
									移除
								</Button>
							</div>
						))}
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						不选择站点人员时，这类通知不会发送邮件。
					</p>
				)}
			</div>

			{externalChannelConfigs.length > 0 ? (
				<details className="rounded-md border px-3 py-2">
					<summary className="cursor-pointer text-sm font-medium">
						其他接收目标
						{event.externalChannelConfigIds.length > 0
							? `（已选择 ${event.externalChannelConfigIds.length} 个）`
							: ""}
					</summary>
					<div className="mt-3 grid gap-2">
						{externalChannelConfigs.map((config) => (
							<label
								key={config.id}
								className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/40"
							>
								<input
									type="checkbox"
									className="mt-1"
									checked={selectedExternalIds.has(config.id)}
									disabled={
										disabled ||
										(!config.enabled && !selectedExternalIds.has(config.id))
									}
									onChange={(changeEvent) => {
										const next = new Set(selectedExternalIds);
										if (changeEvent.target.checked) {
											next.add(config.id);
										} else {
											next.delete(config.id);
										}
										onExternalChannelConfigIdsChange(Array.from(next));
									}}
								/>
								<span className="grid min-w-0">
									<span className="text-sm font-medium">{config.name}</span>
									<span className="text-xs text-muted-foreground">
										{config.type === "webhook" ? "Webhook" : "WxPusher"}
										{config.description ? ` · ${config.description}` : ""}
										{config.enabled ? "" : " · 已停用，可取消选择"}
									</span>
								</span>
							</label>
						))}
					</div>
					{unavailableTargetCount > 0 ? (
						<p className="mt-2 text-xs text-destructive">
							有 {unavailableTargetCount}{" "}
							个目标已停用，不会发送；请取消选择或先到“系统设置 &gt;
							发送服务”重新启用。
						</p>
					) : null}
				</details>
			) : null}
		</div>
	);
}
