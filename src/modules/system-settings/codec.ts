import {
	defaultSystemSettings,
	secretFieldDescriptors,
	secretSystemSettingPaths,
	systemSettingsSchema,
	type SystemSettings,
} from "./definitions";
import { getPathValue, setPathValue } from "../shared/object-path";

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
	for (const descriptor of secretFieldDescriptors) {
		setPathValue(next, descriptor.valuePath, undefined);
		setPathValue(
			next,
			descriptor.configuredPath,
			Boolean(getPathValue(settings, descriptor.valuePath)),
		);
	}
	return next;
}

export function preserveConfiguredSecrets(
	current: SystemSettings,
	patch: SystemSettings,
): SystemSettings {
	const next = structuredClone(patch);
	for (const descriptor of secretFieldDescriptors) {
		const value = getPathValue(next, descriptor.valuePath);
		const storedValue =
			value === undefined || value === ""
				? getPathValue(current, descriptor.valuePath)
				: value;
		setPathValue(next, descriptor.valuePath, storedValue);
		setPathValue(next, descriptor.configuredPath, Boolean(storedValue));
	}
	return systemSettingsSchema.parse(next);
}
