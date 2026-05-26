import { z } from "zod";

import { commentStatusSchema } from "../../comments/moderation-types";

export const QINGYAN_EXPORT_FORMAT = "qingyan.export.v1";
export const QINGYAN_EXPORT_FORMAT_VERSION = 2;
export const QINGYAN_EXPORT_SOURCE_TYPE = "qingyan-export";

const sourceRefSchema = z.object({
	type: z.literal("qingyan"),
	id: z.string().min(1),
});

const timestampsSchema = z
	.object({
		createdAt: z.string().optional(),
		updatedAt: z.string().optional(),
		deletedAt: z.string().nullable().optional(),
		lastSeenAt: z.string().optional(),
	})
	.passthrough();

export const qingyanExportSchema = z.object({
	format: z.literal(QINGYAN_EXPORT_FORMAT),
	formatVersion: z.literal(QINGYAN_EXPORT_FORMAT_VERSION),
	createdAt: z.string(),
	generator: z.object({
		name: z.string(),
		version: z.string(),
	}),
	scope: z.object({
		type: z.literal("site"),
		siteKey: z.string().min(1),
	}),
	schema: z
		.object({
			entitiesVersion: z.literal(1),
			sourceDatabase: z.string(),
			sourceMigrations: z.array(z.string()),
		})
		.passthrough(),
	data: z.object({
		site: z.object({
			siteKey: z.string().min(1),
			name: z.string().min(1),
			allowedOrigins: z.array(z.string()),
		}),
		siteSettings: z.record(z.string(), z.unknown()).nullable().optional(),
		systemSettings: z
			.array(z.record(z.string(), z.unknown()))
			.nullable()
			.optional(),
		pageThreads: z.array(
			z
				.object({
					id: z.string().min(1),
					source: sourceRefSchema,
					siteKey: z.string().min(1),
					pageKey: z.string().min(1),
					pageTitle: z.string().nullable().optional(),
					pageUrl: z.string().nullable().optional(),
					stats: z.record(z.string(), z.unknown()).optional(),
					timestamps: timestampsSchema.optional(),
				})
				.passthrough(),
		),
		visitors: z.array(
			z
				.object({
					id: z.string().min(1),
					source: sourceRefSchema,
					siteKey: z.string().min(1),
					visitorKey: z.string().min(1),
					ipHash: z.string().nullable().optional(),
					userAgentHash: z.string().nullable().optional(),
					timestamps: timestampsSchema.optional(),
				})
				.passthrough(),
		),
		comments: z.array(
			z
				.object({
					id: z.string().min(1),
					source: sourceRefSchema,
					siteKey: z.string().min(1),
					pageKey: z.string().min(1),
					parentId: z.string().nullable().optional(),
					visitorKey: z.string().nullable().optional(),
					status: commentStatusSchema,
					author: z
						.object({
							name: z.string().min(1),
							email: z.string().nullable().optional(),
							website: z.string().nullable().optional(),
						})
						.passthrough(),
					request: z
						.object({
							ip: z.string().nullable().optional(),
							userAgent: z.string().nullable().optional(),
						})
						.passthrough()
						.optional(),
					metadata: z.record(z.string(), z.unknown()).optional(),
					content: z.object({
						raw: z.string(),
						html: z.string().nullable().optional(),
					}),
					stats: z.record(z.string(), z.unknown()).optional(),
					flags: z.record(z.string(), z.unknown()).optional(),
					timestamps: timestampsSchema.optional(),
					extensions: z.record(z.string(), z.unknown()).optional(),
				})
				.passthrough(),
		),
		voteRecords: z.array(z.record(z.string(), z.unknown())),
		pageFeedbackRecords: z.array(z.record(z.string(), z.unknown())),
		blacklistRules: z.array(z.record(z.string(), z.unknown())),
	}),
});

export type QingYanExport = z.infer<typeof qingyanExportSchema>;
export type QingYanExportPageThread =
	QingYanExport["data"]["pageThreads"][number];
export type QingYanExportVisitor = QingYanExport["data"]["visitors"][number];
export type QingYanExportComment = QingYanExport["data"]["comments"][number];
export type QingYanExportSiteSettings = NonNullable<
	QingYanExport["data"]["siteSettings"]
>;

export function parseQingYanExport(payload: unknown): QingYanExport {
	const versionCandidate = z
		.object({
			format: z.string().optional(),
			formatVersion: z.number().optional(),
		})
		.passthrough()
		.safeParse(payload);
	if (
		versionCandidate.success &&
		versionCandidate.data.format === QINGYAN_EXPORT_FORMAT &&
		versionCandidate.data.formatVersion !== undefined &&
		versionCandidate.data.formatVersion > QINGYAN_EXPORT_FORMAT_VERSION
	) {
		throw new Error(
			`Unsupported qingyan.export.v1 formatVersion: ${versionCandidate.data.formatVersion}`,
		);
	}

	return qingyanExportSchema.parse(payload);
}

export function qingyanSourceKey(entityType: string, sourceId: string) {
	return `qingyan:${entityType}:${sourceId}`;
}
