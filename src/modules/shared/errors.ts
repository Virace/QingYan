export class AppError extends Error {
	public constructor(
		public readonly statusCode: number,
		public readonly code: string,
		message: string,
		public readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = new.target.name;
	}
}

export class BlacklistedError extends AppError {
	public constructor() {
		super(403, "BLACKLISTED", "请求已被拒绝。");
	}
}

export class InvalidRequestError extends AppError {
	public constructor(details?: Record<string, unknown>) {
		super(400, "INVALID_REQUEST", "请求参数无效。", details);
	}
}

export class ResourceNotFoundError extends AppError {
	public constructor(code: string, message: string) {
		super(404, code, message);
	}
}
