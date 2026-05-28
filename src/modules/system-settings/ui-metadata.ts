export type SettingUiMetadata = {
	label: string;
	description?: string;
	options?: Record<string, string>;
};

export const settingUiMetadata: Record<string, SettingUiMetadata> = {
	"admin.session.sameSite": {
		label: "后台 Cookie SameSite 策略",
		description: "控制浏览器跨站请求是否携带后台登录 Cookie。",
		options: {
			strict: "严格限制跨站请求",
			lax: "常规站点访问",
			none: "允许跨站嵌入",
		},
	},
	"systemSettings.logging.level": {
		label: "日志等级",
		description: "控制 QingYan 后端输出的最低日志等级。",
		options: {
			error: "仅错误",
			warn: "警告及错误",
			info: "常规信息",
			debug: "调试信息",
		},
	},
	"systemSettings.captcha.provider": {
		label: "验证码服务",
		description: "选择评论提交时使用的验证码服务。",
		options: {
			image: "内置图片验证码",
			turnstile: "Cloudflare Turnstile",
			hcaptcha: "hCaptcha",
			recaptcha: "Google reCAPTCHA",
			geetest: "极验 GeeTest",
		},
	},
	"systemSettings.captcha.recaptcha.variant": {
		label: "reCAPTCHA 验证模式",
		description: "选择 reCAPTCHA Enterprise 的验证方式。",
		options: {
			score_based: "分数判断",
			policy_based_challenge: "策略挑战",
		},
	},
	"systemSettings.ipRegion.cachePolicy": {
		label: "IP 数据库加载方式",
		description: "决定 IP 数据库在运行时如何加载。",
		options: {
			file: "按文件读取",
			vectorIndex: "向量索引缓存",
			content: "完整加载到内存",
		},
	},
	"systemSettings.ipRegion.precision": {
		label: "IP 地域精度",
		description: "控制公开展示或后台记录的默认地域粒度。",
		options: {
			country: "国家",
			province: "省份",
			city: "城市",
		},
	},
	"systemSettings.avatar.external.enabled": {
		label: "启用外部头像 URL",
		description: "开启后公开评论作者会返回 author.avatarUrl。",
	},
	"systemSettings.avatar.external.baseUrl": {
		label: "头像接口地址",
		description: "外部头像服务的 avatar endpoint，不包含邮箱 hash。",
	},
	"systemSettings.avatar.external.hashAlgorithm": {
		label: "邮箱哈希算法",
		description: "按外部头像服务文档选择。",
		options: {
			sha256: "SHA-256",
			md5: "MD5",
		},
	},
	"systemSettings.avatar.external.query": {
		label: "头像 URL 参数",
		description: "不包含开头的 ?，多个参数用 & 分隔。",
	},
	"systemSettings.avatar.display.shape": {
		label: "头像形状",
		description: "给前端评论组件的头像展示形状建议。",
		options: {
			circle: "圆形",
			rounded: "圆角",
			square: "方形",
		},
	},
	"systemSettings.admin.session.ttlMinutes": {
		label: "后台登录有效期",
	},
	"systemSettings.mail.smtp.password": {
		label: "SMTP 密码",
	},
	"systemSettings.captcha.turnstile.secretKey": {
		label: "Turnstile 密钥",
	},
};

function humanizeSettingPath(path: string): string {
	return path
		.replace(/^systemSettings\./, "")
		.split(".")
		.filter(Boolean)
		.join(" / ");
}

export function getSettingLabel(path: string): string {
	return settingUiMetadata[path]?.label ?? humanizeSettingPath(path);
}

export function getSettingOptionLabel(path: string, value: string): string {
	return settingUiMetadata[path]?.options?.[value] ?? value;
}
