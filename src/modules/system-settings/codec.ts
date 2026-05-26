import {
	defaultSystemSettings,
	secretSystemSettingPaths,
	systemSettingsSchema,
	type SystemSettings,
} from "./definitions";

export interface SystemSettingRow {
	category: string;
	key: string;
	valueJson: string;
}

export interface SystemSettingUpsert {
	category: string;
	key: string;
	value: unknown;
	secret: boolean;
}

function setPathValue(
	target: Record<string, unknown>,
	path: string,
	value: unknown,
) {
	const keys = path.split(".");
	let cursor = target;
	for (const key of keys.slice(0, -1)) {
		const next = cursor[key];
		if (!next || typeof next !== "object" || Array.isArray(next)) {
			cursor[key] = {};
		}
		cursor = cursor[key] as Record<string, unknown>;
	}
	cursor[keys[keys.length - 1] ?? ""] = value;
}

function flattenObject(
	value: unknown,
	prefix: string,
	output: SystemSettingUpsert[],
) {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		for (const [key, nested] of Object.entries(value)) {
			flattenObject(nested, prefix ? `${prefix}.${key}` : key, output);
		}
		return;
	}

	const [category, ...keyParts] = prefix.split(".");
	if (!category || keyParts.length === 0) {
		return;
	}
	const key = keyParts.join(".");
	const path = `${category}.${key}`;
	output.push({
		category,
		key,
		value,
		secret: secretSystemSettingPaths.has(path),
	});
}

export function readSystemSettingsRows(
	rows: SystemSettingRow[],
	defaults: SystemSettings = defaultSystemSettings,
): SystemSettings {
	const settings = structuredClone(defaults) as unknown as Record<
		string,
		unknown
	>;
	for (const row of rows) {
		setPathValue(
			settings,
			`${row.category}.${row.key}`,
			JSON.parse(row.valueJson) as unknown,
		);
	}
	return systemSettingsSchema.parse(settings);
}

export function flattenSystemSettings(
	settings: SystemSettings,
): SystemSettingUpsert[] {
	const output: SystemSettingUpsert[] = [];
	flattenObject(systemSettingsSchema.parse(settings), "", output);
	return output;
}

export function maskSystemSettings(settings: SystemSettings): SystemSettings {
	const next = structuredClone(settings);
	next.mail.smtp.password = undefined;
	next.mail.smtp.passwordConfigured = Boolean(settings.mail.smtp.password);
	next.captcha.turnstile.secretKey = undefined;
	next.captcha.turnstile.secretKeyConfigured = Boolean(
		settings.captcha.turnstile.secretKey,
	);
	next.captcha.hcaptcha.secretKey = undefined;
	next.captcha.hcaptcha.secretKeyConfigured = Boolean(
		settings.captcha.hcaptcha.secretKey,
	);
	next.captcha.recaptcha.apiKey = undefined;
	next.captcha.recaptcha.apiKeyConfigured = Boolean(
		settings.captcha.recaptcha.apiKey,
	);
	next.captcha.geetest.captchaKey = undefined;
	next.captcha.geetest.captchaKeyConfigured = Boolean(
		settings.captcha.geetest.captchaKey,
	);
	next.antiSpam.akismet.apiKey = undefined;
	next.antiSpam.akismet.apiKeyConfigured = Boolean(
		settings.antiSpam.akismet.apiKey,
	);
	return next;
}
