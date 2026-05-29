import { z } from "zod";

import type { AppConfig } from "../../config/types";
import { externalAvatarHashAlgorithms } from "../comments/gravatar";
import { normalizeOrigin } from "../shared/url-policy";

export const systemSettingCategories = [
	"admin",
	"security",
	"logging",
	"mail",
	"captcha",
	"ipRegion",
	"avatar",
	"publicApi",
	"antiSpam",
] as const;

export type SystemSettingCategory = (typeof systemSettingCategories)[number];

export const defaultAdminSessionTtlMinutes = 4320;

export const captchaProviderSchema = z.enum([
	"image",
	"turnstile",
	"hcaptcha",
	"recaptcha",
	"geetest",
]);

const originSchema = z.string().transform((value, context) => {
	try {
		return normalizeOrigin(value);
	} catch {
		context.addIssue({
			code: "custom",
			message: "必须是纯 http/https origin。",
		});
		return z.NEVER;
	}
});

const requestRateLimitRuleSchema = z.object({
	windowSec: z.number().int().positive(),
	maxRequests: z.number().int().positive(),
});

const failureRateLimitRuleSchema = z.object({
	windowSec: z.number().int().positive(),
	maxFailures: z.number().int().positive(),
});

const adminLoginRateLimitRuleSchema = failureRateLimitRuleSchema.extend({
	autoBlacklistSec: z.number().int().positive(),
});

export const avatarDisplayShapes = ["circle", "rounded", "square"] as const;

export const avatarSettingsSchema = z.object({
	external: z.object({
		enabled: z.boolean(),
		baseUrl: z.string().url(),
		hashAlgorithm: z.enum(externalAvatarHashAlgorithms),
		query: z
			.string()
			.refine((value) => !value.trim().startsWith("?"), {
				message: "头像 URL 参数不能以 ? 开头。",
			})
			.refine((value) => !value.trim().includes("#"), {
				message: "头像 URL 参数不能包含 #。",
			})
			.refine((value) => !/\s/u.test(value.trim()), {
				message: "头像 URL 参数不能包含空白字符。",
			}),
	}),
	display: z.object({
		shape: z.enum(avatarDisplayShapes),
		sizePx: z.number().int().min(16).max(256),
	}),
});

export const securitySettingsSchema = z.object({
	globalFloodGuard: z.object({
		enabled: z.boolean(),
		windowSec: z.number().int().positive(),
		maxRequests: z.number().int().positive(),
	}),
	publicOriginGuard: z.object({
		enabled: z.boolean(),
		allowMissingOrigin: z.boolean(),
	}),
	adminOriginGuard: z.object({
		enabled: z.boolean(),
		allowMissingOrigin: z.boolean(),
		allowedOrigins: z.array(originSchema),
	}),
	rateLimit: z.object({
		adminLogin: adminLoginRateLimitRuleSchema,
		commentCreate: requestRateLimitRuleSchema,
		commentVote: requestRateLimitRuleSchema,
		captchaVerify: failureRateLimitRuleSchema,
		pageLike: requestRateLimitRuleSchema,
	}),
});

export const systemSettingsSchema = z.object({
	admin: z.object({
		session: z.object({
			ttlMinutes: z.number().int().positive(),
		}),
	}),
	security: securitySettingsSchema,
	logging: z.object({
		level: z.enum(["error", "warn", "info", "debug"]),
		retentionDays: z.number().int().min(1).max(3650),
	}),
	mail: z.object({
		enabled: z.boolean(),
		smtp: z.object({
			host: z.string(),
			port: z.number().int().positive(),
			secure: z.boolean(),
			username: z.string(),
			password: z.string().optional(),
			passwordConfigured: z.boolean(),
			from: z.string(),
		}),
	}),
	captcha: z.object({
		provider: captchaProviderSchema,
		image: z.object({
			width: z.number().int().positive(),
			height: z.number().int().positive(),
			ttlSec: z.number().int().positive(),
		}),
		turnstile: z.object({
			siteKey: z.string(),
			secretKey: z.string().optional(),
			secretKeyConfigured: z.boolean(),
			expectedAction: z.string(),
			expectedHostname: z.string().optional(),
		}),
		hcaptcha: z.object({
			siteKey: z.string(),
			secretKey: z.string().optional(),
			secretKeyConfigured: z.boolean(),
			expectedHostname: z.string().optional(),
		}),
		recaptcha: z.object({
			variant: z.enum(["score_based", "policy_based_challenge"]),
			projectId: z.string(),
			siteKey: z.string(),
			apiKey: z.string().optional(),
			apiKeyConfigured: z.boolean(),
			expectedAction: z.string(),
			expectedHostname: z.string().optional(),
			minScore: z.number().min(0).max(1),
		}),
		geetest: z.object({
			captchaId: z.string(),
			captchaKey: z.string().optional(),
			captchaKeyConfigured: z.boolean(),
			apiServer: z.string().url(),
		}),
	}),
	ipRegion: z.object({
		enabled: z.boolean(),
		cachePolicy: z.enum(["file", "vectorIndex", "content"]),
		precision: z.enum(["country", "province", "city"]),
		autoUpdate: z.object({
			enabled: z.boolean(),
			schedule: z.literal("monthly"),
		}),
		ipv4: z.object({
			dbPath: z.string().min(1),
			sources: z.array(z.string().url()),
		}),
		ipv6: z.object({
			dbPath: z.string().min(1),
			sources: z.array(z.string().url()),
		}),
	}),
	avatar: avatarSettingsSchema,
	publicApi: z.object({
		advisoryFields: z.object({
			enabled: z.boolean(),
		}),
	}),
	antiSpam: z.object({
		akismet: z.object({
			apiKey: z.string().optional(),
			apiKeyConfigured: z.boolean(),
		}),
	}),
});

export type SystemSettings = z.infer<typeof systemSettingsSchema>;

export const defaultSystemSettings: SystemSettings = {
	admin: {
		session: {
			ttlMinutes: defaultAdminSessionTtlMinutes,
		},
	},
	security: {
		globalFloodGuard: {
			enabled: true,
			windowSec: 10,
			maxRequests: 120,
		},
		publicOriginGuard: {
			enabled: true,
			allowMissingOrigin: false,
		},
		adminOriginGuard: {
			enabled: true,
			allowMissingOrigin: false,
			allowedOrigins: [],
		},
		rateLimit: {
			adminLogin: {
				windowSec: 600,
				maxFailures: 5,
				autoBlacklistSec: 1800,
			},
			commentCreate: {
				windowSec: 300,
				maxRequests: 5,
			},
			commentVote: {
				windowSec: 300,
				maxRequests: 15,
			},
			captchaVerify: {
				windowSec: 300,
				maxFailures: 8,
			},
			pageLike: {
				windowSec: 300,
				maxRequests: 10,
			},
		},
	},
	logging: {
		level: "info",
		retentionDays: 7,
	},
	mail: {
		enabled: false,
		smtp: {
			host: "",
			port: 465,
			secure: true,
			username: "",
			password: "",
			passwordConfigured: false,
			from: "",
		},
	},
	captcha: {
		provider: "image",
		image: {
			width: 160,
			height: 60,
			ttlSec: 600,
		},
		turnstile: {
			siteKey: "",
			secretKey: "",
			secretKeyConfigured: false,
			expectedAction: "comment",
		},
		hcaptcha: {
			siteKey: "",
			secretKey: "",
			secretKeyConfigured: false,
		},
		recaptcha: {
			variant: "score_based",
			projectId: "",
			siteKey: "",
			apiKey: "",
			apiKeyConfigured: false,
			expectedAction: "comment",
			minScore: 0.5,
		},
		geetest: {
			captchaId: "",
			captchaKey: "",
			captchaKeyConfigured: false,
			apiServer: "https://gcaptcha4.geetest.com",
		},
	},
	ipRegion: {
		enabled: false,
		cachePolicy: "vectorIndex",
		precision: "province",
		autoUpdate: {
			enabled: false,
			schedule: "monthly",
		},
		ipv4: {
			dbPath: "./data/ip2region_v4.xdb",
			sources: [
				"https://gitee.com/lionsoul/ip2region/raw/master/data/ip2region_v4.xdb",
				"https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb",
			],
		},
		ipv6: {
			dbPath: "./data/ip2region_v6.xdb",
			sources: [
				"https://gitee.com/lionsoul/ip2region/raw/master/data/ip2region_v6.xdb",
				"https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v6.xdb",
			],
		},
	},
	avatar: {
		external: {
			enabled: false,
			baseUrl: "https://gravatar.com/avatar",
			hashAlgorithm: "sha256",
			query: "s=80&d=404&r=g",
		},
		display: {
			shape: "circle",
			sizePx: 40,
		},
	},
	publicApi: {
		advisoryFields: {
			enabled: false,
		},
	},
	antiSpam: {
		akismet: {
			apiKey: "",
			apiKeyConfigured: false,
		},
	},
};

export const secretFieldDescriptors = [
	{
		valuePath: "mail.smtp.password",
		configuredPath: "mail.smtp.passwordConfigured",
	},
	{
		valuePath: "captcha.turnstile.secretKey",
		configuredPath: "captcha.turnstile.secretKeyConfigured",
	},
	{
		valuePath: "captcha.hcaptcha.secretKey",
		configuredPath: "captcha.hcaptcha.secretKeyConfigured",
	},
	{
		valuePath: "captcha.recaptcha.apiKey",
		configuredPath: "captcha.recaptcha.apiKeyConfigured",
	},
	{
		valuePath: "captcha.geetest.captchaKey",
		configuredPath: "captcha.geetest.captchaKeyConfigured",
	},
	{
		valuePath: "antiSpam.akismet.apiKey",
		configuredPath: "antiSpam.akismet.apiKeyConfigured",
	},
] as const;

export const secretSystemSettingPaths: ReadonlySet<string> = new Set(
	secretFieldDescriptors.map((descriptor) => descriptor.valuePath),
);

export function createSystemSettingsDefaults(input?: {
	adminSession?: SystemSettings["admin"]["session"];
	security?: AppConfig["security"];
}): SystemSettings {
	const defaults = structuredClone(defaultSystemSettings);
	if (input?.adminSession) {
		defaults.admin.session = structuredClone(input.adminSession);
	}
	if (input?.security) {
		const startupRateLimit = input.security.rateLimit;
		defaults.security = securitySettingsSchema.parse({
			globalFloodGuard: input.security.globalFloodGuard,
			publicOriginGuard: input.security.publicOriginGuard,
			adminOriginGuard: input.security.adminOriginGuard,
			rateLimit: {
				adminLogin: {
					...defaultSystemSettings.security.rateLimit.adminLogin,
					...startupRateLimit.adminLogin,
				},
				commentCreate: {
					...defaultSystemSettings.security.rateLimit.commentCreate,
					...startupRateLimit.commentCreate,
				},
				commentVote: {
					...defaultSystemSettings.security.rateLimit.commentVote,
					...startupRateLimit.commentVote,
				},
				captchaVerify: {
					...defaultSystemSettings.security.rateLimit.captchaVerify,
					...startupRateLimit.captchaVerify,
				},
				pageLike: {
					...defaultSystemSettings.security.rateLimit.pageLike,
					...(startupRateLimit.pageLike ?? {}),
				},
			},
		});
	}
	return defaults;
}
