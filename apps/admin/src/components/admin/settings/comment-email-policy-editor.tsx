import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
	type CommentEmailPolicy,
	type CommentEmailRule,
	previewCommentEmailPolicy,
} from "@/api/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, inputClass, SettingsSection } from "../shared/admin-ui";

function useRuleKeys() {
	const keys = useRef(new WeakMap<object, string>());
	const key = (rule: object) => {
		let value = keys.current.get(rule);
		if (!value) {
			value = crypto.randomUUID();
			keys.current.set(rule, value);
		}
		return value;
	};
	return {
		key,
		copy: <T extends object>(previous: object, next: T): T => {
			keys.current.set(next, key(previous));
			return next;
		},
	};
}

function RuleList({
	label,
	rules,
	onChange,
}: {
	label: string;
	rules: CommentEmailRule[];
	onChange: (rules: CommentEmailRule[]) => void;
}) {
	const keys = useRuleKeys();
	const replace = (index: number, rule: CommentEmailRule) =>
		onChange(
			rules.map((current, offset) =>
				offset === index ? keys.copy(current, rule) : current,
			),
		);
	return (
		<fieldset className="grid min-w-0 gap-2">
			<legend className="mb-2 text-sm font-semibold">{label}</legend>
			{rules.map((rule, index) => (
				<div
					key={keys.key(rule)}
					className="grid min-w-0 items-end gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto_auto]"
				>
					<Field label={`${label} ${index + 1} 类型`}>
						<select
							className={inputClass}
							value={rule.type}
							onChange={(event) =>
								replace(
									index,
									event.target.value === "email"
										? { type: "email", value: rule.value }
										: {
												type: "domain",
												value: rule.value,
												includeSubdomains: false,
											},
								)
							}
						>
							<option value="domain">邮箱域名</option>
							<option value="email">完整邮箱</option>
						</select>
					</Field>
					<Field label={`${label} ${index + 1} 内容`}>
						<Input
							value={rule.value}
							placeholder={
								rule.type === "email" ? "name@example.org" : "example.org"
							}
							onChange={(event) =>
								replace(index, { ...rule, value: event.target.value })
							}
						/>
					</Field>
					<label className="flex min-h-9 items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={rule.type === "domain" && rule.includeSubdomains}
							disabled={rule.type !== "domain"}
							onChange={(event) =>
								rule.type === "domain" &&
								replace(index, {
									...rule,
									includeSubdomains: event.target.checked,
								})
							}
						/>
						包含子域名
					</label>
					<Button
						type="button"
						variant="ghost"
						onClick={() =>
							onChange(rules.filter((_, offset) => offset !== index))
						}
						aria-label={`移除${label} ${index + 1}`}
					>
						移除
					</Button>
				</div>
			))}
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="justify-self-start"
				onClick={() =>
					onChange([
						...rules,
						{ type: "domain", value: "", includeSubdomains: false },
					])
				}
			>
				添加{label}
			</Button>
		</fieldset>
	);
}

export function CommentEmailPolicyEditor({
	siteKey,
	policy,
	verifiedAuthorEmail,
	onChange,
	error,
}: {
	siteKey: string;
	policy: CommentEmailPolicy;
	verifiedAuthorEmail: string;
	onChange: (policy: CommentEmailPolicy) => void;
	error?: string;
}) {
	const protectedKeys = useRuleKeys();
	const [email, setEmail] = useState("");
	const [identity, setIdentity] = useState<"visitor" | "current_account">(
		"visitor",
	);
	const preview = useMutation({
		mutationFn: (input: {
			email: string;
			policy: CommentEmailPolicy;
			verifiedAuthorEmail: string;
			identity: "visitor" | "current_account";
		}) => previewCommentEmailPolicy(siteKey, input),
	});
	const currentPreview =
		preview.data &&
		preview.variables?.email ===
			(identity === "current_account" ? "preview@example.test" : email) &&
		preview.variables.identity === identity &&
		preview.variables.verifiedAuthorEmail === verifiedAuthorEmail &&
		JSON.stringify(preview.variables.policy) === JSON.stringify(policy);
	return (
		<SettingsSection
			title="邮箱使用规则"
			description="访客来源规则不改变后台账号和通知收件人。受保护域名及指定作者邮箱需要账号登录和当前站点发言权限。"
		>
			<div className="grid min-w-0 gap-5">
				<Field label="访客邮箱来源">
					<select
						className={`${inputClass} max-w-lg`}
						value={policy.mode}
						onChange={(event) =>
							onChange({
								...policy,
								mode: event.target.value as CommentEmailPolicy["mode"],
							})
						}
					>
						<option value="allow_all">允许各来源，可指定禁用项</option>
						<option value="allow_selected">仅允许指定来源</option>
					</select>
				</Field>
				<RuleList
					label="允许项"
					rules={policy.allowed}
					onChange={(allowed) => onChange({ ...policy, allowed })}
				/>
				<RuleList
					label="禁止项"
					rules={policy.denied}
					onChange={(denied) => onChange({ ...policy, denied })}
				/>
				<fieldset className="grid min-w-0 gap-2">
					<legend className="mb-2 text-sm font-semibold">受保护域名</legend>
					{policy.protectedDomains.map((rule, index) => (
						<div
							key={protectedKeys.key(rule)}
							className="grid min-w-0 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
						>
							<Field label={`受保护域名 ${index + 1}`}>
								<Input
									value={rule.value}
									placeholder="example.org"
									onChange={(event) =>
										onChange({
											...policy,
											protectedDomains: policy.protectedDomains.map(
												(current, offset) =>
													offset === index
														? protectedKeys.copy(current, {
																...current,
																value: event.target.value,
															})
														: current,
											),
										})
									}
								/>
							</Field>
							<label className="flex min-h-9 items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={rule.includeSubdomains}
									onChange={(event) =>
										onChange({
											...policy,
											protectedDomains: policy.protectedDomains.map(
												(current, offset) =>
													offset === index
														? protectedKeys.copy(current, {
																...current,
																includeSubdomains: event.target.checked,
															})
														: current,
											),
										})
									}
								/>
								包含子域名
							</label>
							<Button
								type="button"
								variant="ghost"
								onClick={() =>
									onChange({
										...policy,
										protectedDomains: policy.protectedDomains.filter(
											(_, offset) => offset !== index,
										),
									})
								}
								aria-label={`移除受保护域名 ${index + 1}`}
							>
								移除
							</Button>
						</div>
					))}
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="justify-self-start"
						onClick={() =>
							onChange({
								...policy,
								protectedDomains: [
									...policy.protectedDomains,
									{ value: "", includeSubdomains: false },
								],
							})
						}
					>
						添加保护域名
					</Button>
				</fieldset>
				{error ? (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				) : null}
				<div className="grid gap-3 border-t pt-4">
					<p className="text-sm font-semibold">草稿匹配预览</p>
					<div className="grid max-w-3xl items-end gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
						<Field label="预览身份">
							<select
								className={inputClass}
								value={identity}
								onChange={(event) =>
									setIdentity(event.target.value as typeof identity)
								}
							>
								<option value="visitor">普通访客</option>
								<option value="current_account">当前账号</option>
							</select>
						</Field>
						<Field label={identity === "visitor" ? "访客邮箱" : "当前账号邮箱"}>
							<Input
								value={
									identity === "visitor" ? email : "使用当前账号的生效邮箱"
								}
								disabled={identity === "current_account"}
								onChange={(event) => setEmail(event.target.value)}
							/>
						</Field>
						<Button
							type="button"
							variant="outline"
							disabled={
								preview.isPending || (identity === "visitor" && !email.trim())
							}
							onClick={() =>
								preview.mutate({
									email:
										identity === "current_account"
											? "preview@example.test"
											: email,
									policy: structuredClone(policy),
									verifiedAuthorEmail,
									identity,
								})
							}
						>
							{preview.isPending ? "正在预览…" : "预览匹配"}
						</Button>
					</div>
					<p role="status" className="text-sm text-muted-foreground">
						{preview.isError
							? "无法预览，请检查规则和邮箱格式后重试。"
							: preview.data
								? currentPreview
									? `草稿结果：${preview.data.result === "allowed" ? "允许使用" : preview.data.result === "login_required" ? "需要登录后使用" : "该邮箱暂不支持"}${preview.data.matchedRule ? `（匹配 ${preview.data.matchedRule.value}）` : ""}。尚未保存生效。`
									: "草稿已变化，请重新预览。"
								: "预览不会保存或更改当前规则。"}
					</p>
				</div>
			</div>
		</SettingsSection>
	);
}
