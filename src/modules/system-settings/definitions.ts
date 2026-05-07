import { z } from "zod";

export const systemSettingCategories = [
	"logging",
	"mail",
	"captcha",
	"ipRegion",
	"avatar",
] as const;

export type SystemSettingCategory = (typeof systemSettingCategories)[number];

export const captchaProviderSchema = z.enum([
	"image",
	"turnstile",
	"hcaptcha",
	"recaptcha",
	"geetest",
]);

export const systemSettingsSchema = z.object({
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
	avatar: z.object({
		gravatar: z.object({
			enabled: z.boolean(),
			baseUrl: z.string().url(),
		}),
	}),
});

export type SystemSettings = z.infer<typeof systemSettingsSchema>;

export const defaultSystemSettings: SystemSettings = {
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
				"https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb",
				"https://gitee.com/lionsoul/ip2region/raw/master/data/ip2region_v4.xdb",
			],
		},
		ipv6: {
			dbPath: "./data/ip2region_v6.xdb",
			sources: [
				"https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v6.xdb",
				"https://gitee.com/lionsoul/ip2region/raw/master/data/ip2region_v6.xdb",
			],
		},
	},
	avatar: {
		gravatar: {
			enabled: false,
			baseUrl: "https://gravatar.com/avatar",
		},
	},
};

export const secretSystemSettingPaths = new Set([
	"mail.smtp.password",
	"captcha.turnstile.secretKey",
	"captcha.hcaptcha.secretKey",
	"captcha.recaptcha.apiKey",
	"captcha.geetest.captchaKey",
]);
