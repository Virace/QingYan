import {
	defaultSystemSettings,
	type SystemSettings,
} from "../../system-settings/definitions";
import type { CommentMetadataSettings } from "../../shared/site-settings-defaults";
import type {
	CommentMetadataResolver,
	CommentMetadataSnapshot,
} from "./resolver";

export interface ResolvedRequestMetadata {
	ip?: string;
	userAgent?: string;
	snapshot?: CommentMetadataSnapshot;
}

export function nonEmpty(value?: string | null): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? (value ?? undefined) : undefined;
}

export async function resolveRequestMetadata(input: {
	resolver?: CommentMetadataResolver;
	ip?: string;
	userAgent?: string;
	metadata: CommentMetadataSettings;
	ipRegion?: SystemSettings["ipRegion"];
}): Promise<ResolvedRequestMetadata> {
	const ip = input.metadata.collectIp ? nonEmpty(input.ip) : undefined;
	const userAgent = input.metadata.collectUserAgent
		? nonEmpty(input.userAgent)
		: undefined;
	const snapshot =
		input.resolver && (ip || userAgent)
			? await input.resolver.resolve({
					ip,
					userAgent,
					metadata: input.metadata,
					ipRegion: input.ipRegion ?? defaultSystemSettings.ipRegion,
				})
			: undefined;

	return {
		ip,
		userAgent,
		snapshot,
	};
}
