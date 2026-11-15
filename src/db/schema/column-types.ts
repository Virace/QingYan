import { customType } from "drizzle-orm/pg-core";

import { toUtcTimestamp } from "../values";

/** 身份与通配符查询统一使用 C 比较，不依赖目标数据库的默认 locale。 */
export function exactText<
	const T extends readonly string[] = readonly string[],
>(name: string, _config?: { enum: T }) {
	return customType<{ data: T[number]; driverData: string }>({
		dataType: () => 'text COLLATE "C"',
	})(name);
}

export const utcTimestamp = customType<{ data: string; driverData: string }>({
	dataType: () => "timestamptz(6)",
	toDriver: toUtcTimestamp,
	fromDriver: toUtcTimestamp,
});

/** 仓储边界使用 JSON 文本，数据库内使用 jsonb 的值语义。 */
export const jsonText = customType<{ data: string; driverData: string }>({
	dataType: () => "jsonb",
	toDriver: (value) => {
		JSON.parse(value);
		return value;
	},
	fromDriver: (value) => value,
});

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType: () => "bytea",
});
