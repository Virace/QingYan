import { z } from "zod";

import { validateAdminConsolePath } from "./admin-console-path";
import { DEFAULT_PUBLIC_PATH, normalizePublicPath } from "./public-path";

const rateLimitRuleSchema = z.object({
	windowSec: z.number().int().positive(),
	maxRequests: z.number().int().positive().optional(),
	maxFailures: z.number().int().positive().optional(),
	autoBlacklistSec: z.number().int().positive().optional(),
});

const publicOriginGuardSchema = z.object({
	enabled: z.boolean().default(true),
	allowMissingOrigin: z.boolean().default(false),
});

const adminOriginGuardSchema = z.object({
	enabled: z.boolean().default(true),
	allowMissingOrigin: z.boolean().default(false),
	allowedOrigins: z.array(z.string().url()).default([]),
});

const adminConsoleSchema = z
	.object({
		path: z
			.string()
			.min(1)
			.refine((value) => validateAdminConsolePath(value) === null, {
				message: "admin.console.path must be a safe non-reserved path",
			})
			.optional(),
	})
	.default({});

const adminAuthSchema = z
	.object({
		username: z.string().min(1).optional(),
		passwordHash: z.string().min(1).optional(),
	})
	.default({});

const startupAdminSchema = z
	.object({
		session: z
			.object({
				cookieName: z.string().min(1),
				ttlMinutes: z.number().int().positive(),
				sameSite: z.enum(["strict", "lax", "none"]),
				secure: z.boolean(),
			})
			.strict(),
	})
	.strict();

const publicPathSchema = z
	.string()
	.optional()
	.transform((value) => normalizePublicPath(value))
	.default(DEFAULT_PUBLIC_PATH);

export const configSchema = z
	.object({
		server: z
			.object({
				host: z.string().min(1),
				port: z.number().int().positive(),
				publicBaseUrl: z.string().url(),
				publicPath: publicPathSchema,
				trustProxy: z.boolean(),
			})
			.strict(),
		database: z
			.object({
				client: z.literal("sqlite"),
				sqlite: z
					.object({
						file: z.string().min(1),
					})
					.strict(),
			})
			.strict(),
		admin: startupAdminSchema,
		security: z
			.object({
				requestIdHeader: z.string().min(1),
				globalFloodGuard: z
					.object({
						enabled: z.boolean(),
						windowSec: z.number().int().positive(),
						maxRequests: z.number().int().positive(),
					})
					.strict(),
				publicOriginGuard: publicOriginGuardSchema.default({
					enabled: true,
					allowMissingOrigin: false,
				}),
				adminOriginGuard: adminOriginGuardSchema.default({
					enabled: true,
					allowMissingOrigin: false,
					allowedOrigins: [],
				}),
				rateLimit: z
					.object({
						adminLogin: rateLimitRuleSchema,
						commentCreate: rateLimitRuleSchema,
						commentVote: rateLimitRuleSchema,
						captchaVerify: rateLimitRuleSchema,
						pageLike: rateLimitRuleSchema.optional(),
					})
					.strict(),
			})
			.strict(),
	})
	.strict();

const loggingConfigSchema = z.object({
	directory: z.string().min(1),
});

export type StartupConfig = z.infer<typeof configSchema>;
export type LoggingConfig = z.infer<typeof loggingConfigSchema>;

export interface TransitionalRuntimeConfig {
	admin: StartupConfig["admin"] & {
		console: z.infer<typeof adminConsoleSchema>;
		auth: z.infer<typeof adminAuthSchema>;
		tokenHash?: string;
	};
	logging: LoggingConfig;
}

export type AppConfig = Omit<StartupConfig, "admin"> &
	Pick<TransitionalRuntimeConfig, "admin" | "logging">;

const transitionalRuntimeDefaults: Omit<TransitionalRuntimeConfig, "admin"> = {
	logging: {
		directory: "./logs",
	},
};

export function withTransitionalRuntimeDefaults(
	config: StartupConfig,
): AppConfig {
	return {
		...structuredClone(config),
		admin: {
			...structuredClone(config.admin),
			console: {},
			auth: {},
		},
		...structuredClone(transitionalRuntimeDefaults),
	};
}
