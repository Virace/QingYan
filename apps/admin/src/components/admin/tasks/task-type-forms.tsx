import type { TaskTypeDefinition } from "@/api/tasks";
import { Input } from "@/components/ui/input";

import { Field, inputClass, textareaClass } from "../shared/admin-ui";

export type TaskPayloadDraft = Record<string, unknown>;

const ipVersions = ["v4", "v6"] as const;

function readText(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function readNumberList(value: unknown): string {
	return Array.isArray(value)
		? value.filter((item) => typeof item === "number").join(", ")
		: "";
}

function readStringList(value: unknown): string {
	return Array.isArray(value)
		? value.filter((item) => typeof item === "string").join("\n")
		: "";
}

function parseNumberList(value: string): number[] | undefined {
	const items = value
		.split(",")
		.map((item) => Number(item.trim()))
		.filter((item) => Number.isInteger(item) && item > 0);
	return items.length > 0 ? items : undefined;
}

function parseStringList(value: string): string[] | undefined {
	const items = Array.from(
		new Set(
			value
				.split(/[\s,]+/)
				.map((item) => item.trim())
				.filter(Boolean),
		),
	);
	return items.length > 0 ? items : undefined;
}

function parseCommaStringList(value: string): string[] | undefined {
	const items = value
		.split(/[,，]/)
		.map((item) => item.trim())
		.filter(Boolean);
	return items.length > 0 ? items : undefined;
}

function readIpVersions(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item) => item === "v4" || item === "v6")
		: ["v4", "v6"];
}

function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function readBoolean(value: unknown, fallback = false): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function optionalNumber(value: string): number | undefined {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function toggleArrayValue(values: string[], value: string, checked: boolean) {
	const next = checked
		? Array.from(new Set([...values, value]))
		: values.filter((item) => item !== value);
	return next.length > 0 ? next : [value];
}

function PayloadInput({
	label,
	value,
	onChange,
	placeholder,
	type = "text",
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	type?: string;
}) {
	return (
		<Field label={label}>
			<Input
				type={type}
				value={value}
				placeholder={placeholder}
				onChange={(event) => onChange(event.target.value)}
			/>
		</Field>
	);
}

function PayloadTextarea({
	label,
	value,
	onChange,
	description,
	placeholder,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	description?: string;
	placeholder?: string;
}) {
	return (
		<Field label={label} description={description}>
			<textarea
				className={textareaClass}
				value={value}
				placeholder={placeholder}
				onChange={(event) => onChange(event.target.value)}
			/>
		</Field>
	);
}

export function TaskTypePayloadForm({
	definition,
	payload,
	siteKey,
	onChange,
}: {
	definition: TaskTypeDefinition | null;
	payload: TaskPayloadDraft;
	siteKey: string;
	onChange: (payload: TaskPayloadDraft) => void;
}) {
	if (!definition) {
		return <p className="text-sm text-muted-foreground">请选择任务类型。</p>;
	}

	const setValue = (key: string, value: unknown) => {
		const next = { ...payload };
		if (value === undefined || value === "" || value === null) {
			delete next[key];
		} else {
			next[key] = value;
		}
		onChange(next);
	};
	const setRecordValue = (key: string, field: string, value: unknown) => {
		const current = readRecord(payload[key]);
		setValue(key, { ...current, [field]: value });
	};

	switch (definition.type) {
		case "page_source_refresh":
			return (
				<div className="grid gap-3 md:grid-cols-2">
					<PayloadInput
						label="站点 Key"
						value={readText(payload.siteKey) || siteKey}
						onChange={(value) => setValue("siteKey", value.trim())}
					/>
					<Field label="刷新模式">
						<select
							className={inputClass}
							value={readText(payload.mode) || "replace"}
							onChange={(event) => setValue("mode", event.target.value)}
						>
							<option value="append">追加/更新</option>
							<option value="replace">按来源替换</option>
						</select>
					</Field>
					<PayloadTextarea
						label="sitemap 地址"
						description="填写一个或多个 sitemap 或 sitemap index URL；可用逗号、空格或换行分隔。"
						value={readStringList(payload.sitemapUrls)}
						placeholder="https://example.com/sitemap-index.xml"
						onChange={(value) =>
							setValue("sitemapUrls", parseStringList(value))
						}
					/>
					<details className="rounded-md border bg-muted/20 p-3 md:col-span-2">
						<summary className="cursor-pointer select-none text-sm font-medium">
							兼容 sourceIds（旧任务迁移/调试）
						</summary>
						<div className="mt-3">
							<PayloadInput
								label="sourceIds"
								value={readNumberList(payload.sourceIds)}
								placeholder="仅旧来源刷新任务使用，例如 1, 2, 3"
								onChange={(value) =>
									setValue("sourceIds", parseNumberList(value))
								}
							/>
						</div>
					</details>
					<PayloadInput
						label="超时毫秒"
						value={payload.timeoutMs ? String(payload.timeoutMs) : ""}
						type="number"
						onChange={(value) => setValue("timeoutMs", optionalNumber(value))}
					/>
				</div>
			);
		case "page_metadata_refresh":
			return (
				<div className="grid gap-3 md:grid-cols-2">
					<PayloadInput
						label="站点 Key"
						value={readText(payload.siteKey) || siteKey}
						onChange={(value) => setValue("siteKey", value.trim())}
					/>
					<Field label="刷新范围">
						<select
							className={inputClass}
							value={readText(payload.scope) || "missing_only"}
							onChange={(event) => setValue("scope", event.target.value)}
						>
							<option value="missing_only">仅缺失 Title</option>
							<option value="force">强制刷新</option>
							<option value="page_keys">指定页面</option>
						</select>
					</Field>
					<PayloadInput
						label="页面 Key"
						value={
							Array.isArray(payload.pageKeys) ? payload.pageKeys.join(", ") : ""
						}
						placeholder="仅指定页面时填写，逗号分隔"
						onChange={(value) =>
							setValue("pageKeys", parseCommaStringList(value))
						}
					/>
					<PayloadInput
						label="批量大小"
						value={payload.batchSize ? String(payload.batchSize) : ""}
						type="number"
						onChange={(value) => setValue("batchSize", optionalNumber(value))}
					/>
				</div>
			);
		case "comment_ip_refresh":
			return (
				<div className="grid gap-3 md:grid-cols-2">
					<PayloadInput
						label="站点 Key"
						value={readText(payload.siteKey)}
						placeholder="留空为全部可用站点"
						onChange={(value) => setValue("siteKey", value.trim())}
					/>
					<Field label="刷新范围">
						<select
							className={inputClass}
							value={readText(payload.scope) || "missing"}
							onChange={(event) => setValue("scope", event.target.value)}
						>
							<option value="missing">缺失定位</option>
							<option value="failed">失败记录</option>
							<option value="stale">过期记录</option>
							<option value="all">全部评论</option>
						</select>
					</Field>
					<IpVersionField
						value={readIpVersions(payload.ipVersions)}
						onChange={(value) => setValue("ipVersions", value)}
					/>
					<PayloadInput
						label="批量大小"
						value={payload.batchSize ? String(payload.batchSize) : ""}
						type="number"
						onChange={(value) => setValue("batchSize", optionalNumber(value))}
					/>
				</div>
			);
		case "ip_region_update":
			return (
				<div className="grid gap-3 md:grid-cols-2">
					<IpVersionField
						value={readIpVersions(payload.ipVersions)}
						onChange={(value) => setValue("ipVersions", value)}
					/>
					<PayloadInput
						label="超时毫秒"
						value={payload.timeoutMs ? String(payload.timeoutMs) : ""}
						type="number"
						onChange={(value) => setValue("timeoutMs", optionalNumber(value))}
					/>
				</div>
			);
		case "backup": {
			const include = readRecord(payload.include);
			return (
				<div className="grid gap-3 md:grid-cols-2">
					<Field label="备份范围">
						<select
							className={inputClass}
							value={readText(payload.scope) || "site"}
							onChange={(event) => setValue("scope", event.target.value)}
						>
							<option value="site">当前站点导出</option>
							<option value="full">完整实例备份</option>
						</select>
					</Field>
					<PayloadInput
						label="站点 Key"
						value={readText(payload.siteKey) || siteKey}
						placeholder="完整备份可留空"
						onChange={(value) => setValue("siteKey", value.trim())}
					/>
					<div className="text-sm text-muted-foreground md:col-span-2">
						备份输出由系统写入任务备份目录。
					</div>
					<PayloadInput
						label="保留份数"
						value={payload.retentionCount ? String(payload.retentionCount) : ""}
						type="number"
						onChange={(value) =>
							setValue("retentionCount", optionalNumber(value))
						}
					/>
					<CheckboxGroup
						label="导出内容"
						items={[
							["siteSettings", "站点设置"],
							["systemSettings", "系统设置"],
							["pageThreads", "页面线程"],
							["comments", "评论"],
							["visitors", "访客"],
							["voteRecords", "投票记录"],
							["pageFeedbackRecords", "页面反馈"],
							["blacklistRules", "黑名单规则"],
							["rawUserAgent", "原始 UA"],
						]}
						values={include}
						defaultChecked
						onChange={(field, checked) =>
							setRecordValue("include", field, checked)
						}
					/>
				</div>
			);
		}
		case "site_settings_action":
			return (
				<div className="grid gap-3 md:grid-cols-2">
					<PayloadInput
						label="站点 Key"
						value={readText(payload.siteKey) || siteKey}
						onChange={(value) => setValue("siteKey", value.trim())}
					/>
					<Field label="临时动作">
						<select
							className={inputClass}
							value={readText(payload.action) || "disable_comments"}
							onChange={(event) => setValue("action", event.target.value)}
						>
							<option value="disable_comments">临时关闭评论</option>
							<option value="disable_visitors">临时关闭访客记录</option>
							<option value="disable_page_views">临时关闭 PV</option>
							<option value="disable_page_reactions">临时关闭点赞/投票</option>
							<option value="disable_metadata_persistence">
								临时关闭请求元数据持久化
							</option>
							<option value="elevate_captcha">临时提升验证码</option>
						</select>
					</Field>
					<PayloadInput
						label="TTL 秒"
						value={payload.ttlSec ? String(payload.ttlSec) : "3600"}
						type="number"
						onChange={(value) => setValue("ttlSec", optionalNumber(value))}
					/>
					<div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs leading-5 text-destructive md:col-span-2">
						危险动作会修改站点行为，创建时保持禁用；启用前需要再次确认。
					</div>
				</div>
			);
		case "blacklist_automation":
			return (
				<div className="grid gap-3 md:grid-cols-2">
					<PayloadInput
						label="站点 Key"
						value={readText(payload.siteKey) || siteKey}
						placeholder="全局黑名单仅限全局管理员"
						onChange={(value) => setValue("siteKey", value.trim())}
					/>
					<Field label="目标类型">
						<select
							className={inputClass}
							value={readText(payload.targetType) || "ip"}
							onChange={(event) => setValue("targetType", event.target.value)}
						>
							<option value="ip">IP</option>
							<option value="email">邮箱</option>
							<option value="visitor">访客</option>
						</select>
					</Field>
					<Field label="匹配模式">
						<select
							className={inputClass}
							value={readText(payload.matchMode) || "exact"}
							onChange={(event) => setValue("matchMode", event.target.value)}
						>
							<option value="exact">精确</option>
							<option value="cidr">CIDR</option>
							<option value="wildcard">通配</option>
						</select>
					</Field>
					<Field label="作用范围">
						<select
							className={inputClass}
							value={readText(payload.scope) || "post"}
							onChange={(event) => setValue("scope", event.target.value)}
						>
							<option value="post">仅评论提交</option>
							<option value="all">所有请求</option>
						</select>
					</Field>
					<PayloadInput
						label="目标值"
						value={readText(payload.targetValue)}
						onChange={(value) => setValue("targetValue", value.trim())}
					/>
					<PayloadInput
						label="有效期秒"
						value={payload.expiresInSec ? String(payload.expiresInSec) : "3600"}
						type="number"
						onChange={(value) =>
							setValue("expiresInSec", optionalNumber(value))
						}
					/>
					<PayloadInput
						label="原因"
						value={readText(payload.reason)}
						onChange={(value) => setValue("reason", value.trim())}
					/>
					<div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs leading-5 text-destructive">
						目标值会在任务日志中脱敏；全局规则由后端权限控制。
					</div>
				</div>
			);
		case "daily_site_digest": {
			const activity = readRecord(payload.activity);
			return (
				<div className="grid gap-3 md:grid-cols-2">
					<PayloadInput
						label="站点 Key"
						value={readText(payload.siteKey) || siteKey}
						onChange={(value) => setValue("siteKey", value.trim())}
					/>
					<Field label="无活动也发送">
						<select
							className={inputClass}
							value={readBoolean(payload.sendIfNoActivity) ? "true" : "false"}
							onChange={(event) =>
								setValue("sendIfNoActivity", event.target.value === "true")
							}
						>
							<option value="false">无活动时跳过</option>
							<option value="true">无活动也发送</option>
						</select>
					</Field>
					<PayloadInput
						label="评论数"
						value={activity.comments ? String(activity.comments) : ""}
						type="number"
						onChange={(value) =>
							setRecordValue("activity", "comments", optionalNumber(value) ?? 0)
						}
					/>
					<PayloadInput
						label="回复数"
						value={activity.replies ? String(activity.replies) : ""}
						type="number"
						onChange={(value) =>
							setRecordValue("activity", "replies", optionalNumber(value) ?? 0)
						}
					/>
					<PayloadInput
						label="PV"
						value={activity.pageViews ? String(activity.pageViews) : ""}
						type="number"
						onChange={(value) =>
							setRecordValue(
								"activity",
								"pageViews",
								optionalNumber(value) ?? 0,
							)
						}
					/>
					<PayloadInput
						label="点赞数"
						value={activity.pageLikes ? String(activity.pageLikes) : ""}
						type="number"
						onChange={(value) =>
							setRecordValue(
								"activity",
								"pageLikes",
								optionalNumber(value) ?? 0,
							)
						}
					/>
					<PayloadInput
						label="未知页面"
						value={activity.unknownPages ? String(activity.unknownPages) : ""}
						type="number"
						onChange={(value) =>
							setRecordValue(
								"activity",
								"unknownPages",
								optionalNumber(value) ?? 0,
							)
						}
					/>
					<PayloadInput
						label="任务失败"
						value={activity.taskFailures ? String(activity.taskFailures) : ""}
						type="number"
						onChange={(value) =>
							setRecordValue(
								"activity",
								"taskFailures",
								optionalNumber(value) ?? 0,
							)
						}
					/>
				</div>
			);
		}
		default:
			return (
				<div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
					该任务类型尚未提供专属参数表单。
				</div>
			);
	}
}

function IpVersionField({
	value,
	onChange,
}: {
	value: string[];
	onChange: (value: string[]) => void;
}) {
	return (
		<Field label="IP 版本">
			<div className="flex min-h-9 flex-wrap items-center gap-4 rounded-md border bg-background px-3 py-2 text-sm">
				{ipVersions.map((version) => (
					<label key={version} className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={value.includes(version)}
							onChange={(event) =>
								onChange(toggleArrayValue(value, version, event.target.checked))
							}
							className="size-4 rounded border-input"
						/>
						<span>{version.toUpperCase()}</span>
					</label>
				))}
			</div>
		</Field>
	);
}

function CheckboxGroup({
	label,
	items,
	values,
	defaultChecked = false,
	onChange,
}: {
	label: string;
	items: Array<[string, string]>;
	values: Record<string, unknown>;
	defaultChecked?: boolean;
	onChange: (field: string, checked: boolean) => void;
}) {
	return (
		<Field label={label}>
			<div className="grid gap-2 rounded-md border bg-background p-3 text-sm md:grid-cols-2">
				{items.map(([field, title]) => (
					<label key={field} className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={readBoolean(values[field], defaultChecked)}
							onChange={(event) => onChange(field, event.target.checked)}
							className="size-4 rounded border-input"
						/>
						<span>{title}</span>
					</label>
				))}
			</div>
		</Field>
	);
}
