export const loggingLevelLabels = {
	error: "仅错误",
	warn: "警告及错误",
	info: "常规信息",
	debug: "调试信息",
} as const;

export const captchaProviderLabels = {
	image: "内置图片验证码",
	turnstile: "Cloudflare Turnstile",
	hcaptcha: "hCaptcha",
	recaptcha: "Google reCAPTCHA",
	geetest: "极验 GeeTest",
} as const;

export const recaptchaVariantLabels = {
	score_based: "分数判断",
	policy_based_challenge: "策略挑战",
} as const;

export const ipRegionCachePolicyLabels = {
	file: "按文件读取",
	vectorIndex: "向量索引缓存",
	content: "完整加载到内存",
} as const;

export const blacklistTargetTypeLabels = {
	email: "邮箱",
	visitor: "访客",
	ip: "IP",
} as const;

export const blacklistMatchModeLabels = {
	exact: "精确",
	wildcard: "通配",
	cidr: "CIDR",
} as const;

export const allowlistMatchModeLabels = {
	exact: "精确",
	cidr: "CIDR",
	domain: "域名",
} as const;

export const scopeLabels = {
	post: "当前页面",
	all: "全局",
} as const;

export const qingyanExistingStrategyLabels = {
	fail_on_existing: "发现已有数据时停止",
	skip_existing: "跳过已有数据",
} as const;

export function labelFor<T extends string>(
	labels: Partial<Record<T, string>>,
	value: T,
): string {
	return labels[value] ?? value;
}
