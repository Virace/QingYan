import { AppError } from "./errors";
import { restrictionRecovery } from "./restriction-recovery";

export function buildErrorResponse(
	error: unknown,
	requestId?: string,
	publicPath = "/qingyan",
) {
	if (error instanceof AppError) {
		const recovery = restrictionRecovery(error, publicPath);
		const fields =
			error.code === "VALIDATION_FAILED" && Array.isArray(error.details?.fields)
				? { fields: error.details.fields }
				: {};
		const details =
			error.details && error.code !== "VALIDATION_FAILED"
				? { details: error.details }
				: {};
		return {
			statusCode: error.statusCode,
			retryAfterSec: recovery?.retryAfterSec,
			body: {
				error: {
					code: error.code,
					message: error.message,
					requestId,
					...fields,
					...details,
					...(recovery ? { recovery } : {}),
				},
			},
		};
	}
	return {
		statusCode: 500,
		retryAfterSec: undefined,
		body: {
			error: {
				code: "INTERNAL_ERROR",
				message: "服务器内部错误。",
				requestId,
			},
		},
	};
}
