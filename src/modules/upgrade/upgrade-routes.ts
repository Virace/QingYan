import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { AppError, InvalidRequestError } from "../shared/errors";
import type { UpgradeService } from "./upgrade-service";

export const UPGRADE_PATH = "/upgrade";

const upgradeApplySchema = z.object({
	token: z.string().optional(),
	confirm: z.literal("UPGRADE QINGYAN"),
	backupDirectory: z.string().min(1).optional(),
});

function assertToken(input: { payloadToken?: string; expectedToken: string }) {
	if (input.payloadToken !== input.expectedToken) {
		throw new AppError(403, "UPGRADE_TOKEN_INVALID", "升级令牌无效。");
	}
}

export const upgradeRoutes: FastifyPluginAsync<{
	service: UpgradeService;
	token: string;
}> = async (fastify, options) => {
	fastify.get("/state", async () => options.service.publicState());

	fastify.post("/apply", async (request) => {
		const parsed = upgradeApplySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		assertToken({
			payloadToken: parsed.data.token,
			expectedToken: options.token,
		});
		try {
			return await options.service.apply(parsed.data);
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.startsWith("UPGRADE_STATE_INVALID:")
			) {
				throw new AppError(
					409,
					"UPGRADE_STATE_INVALID",
					"当前状态不允许升级。",
				);
			}
			if (
				error instanceof Error &&
				error.message === "UPGRADE_CONFIRMATION_REQUIRED"
			) {
				throw new InvalidRequestError({
					confirm: "确认文本必须为 UPGRADE QINGYAN。",
				});
			}
			throw error;
		}
	});
};
