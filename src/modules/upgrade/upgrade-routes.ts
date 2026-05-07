import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { AppError, InvalidRequestError } from "../shared/errors";
import type { UpgradeService } from "./upgrade-service";

export const UPGRADE_COOKIE_NAME = "qingyan_upgrade";
export const UPGRADE_PATH = "/upgrade";

const upgradeApplySchema = z.object({
	token: z.string().optional(),
	confirm: z.literal("UPGRADE QINGYAN"),
	backupDirectory: z.string().min(1).optional(),
});

function readUpgradeCookie(
	cookieHeader: string | undefined,
): string | undefined {
	if (!cookieHeader) {
		return undefined;
	}
	for (const part of cookieHeader.split(";")) {
		const [name, ...valueParts] = part.trim().split("=");
		if (name === UPGRADE_COOKIE_NAME) {
			return decodeURIComponent(valueParts.join("="));
		}
	}
	return undefined;
}

function assertToken(input: {
	payloadToken?: string;
	cookieHeader?: string;
	expectedToken: string;
}) {
	const token = input.payloadToken ?? readUpgradeCookie(input.cookieHeader);
	if (token !== input.expectedToken) {
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
			cookieHeader: request.headers.cookie,
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
