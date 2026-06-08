export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export type UpgradeChangeAction = "add" | "update" | "remove" | "move";
export type UpgradeValueKind = "plain" | "secret";

export interface UpgradeMigrationStep {
	name: string;
	description?: string;
}

export interface UpgradeApplicationStep {
	name: string;
	fromVersion?: string;
	toVersion?: string;
	summary?: JsonValue;
}

export interface UpgradeFieldChange {
	path: string;
	action: UpgradeChangeAction;
	before?: JsonValue;
	after?: JsonValue;
	valueKind?: UpgradeValueKind;
	note?: string;
}

export interface UpgradeBackupPaths {
	config?: string;
	database?: string;
	sqliteWal?: string;
	sqliteShm?: string;
	plan?: string;
}

export interface UpgradePlan {
	currentVersion: string;
	targetVersion: string;
	schemaMigrations: UpgradeMigrationStep[];
	applicationUpgrades: UpgradeApplicationStep[];
	configChanges: UpgradeFieldChange[];
	dbSettingChanges: UpgradeFieldChange[];
	secretHandling: string[];
	backupPaths: UpgradeBackupPaths;
	risks: string[];
}

export type PublicUpgradePlan = UpgradePlan;

const REDACTED_VALUE = "[redacted]";
const SECRET_KEY_PATTERN =
	/(password|secret|token|apikey|api_key|privatekey|private_key|credential)/i;

function redactJsonValue(value: JsonValue): JsonValue {
	if (Array.isArray(value)) {
		return value.map((item) => redactJsonValue(item));
	}
	if (!value || typeof value !== "object") {
		return value;
	}

	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [
			key,
			SECRET_KEY_PATTERN.test(key) ? REDACTED_VALUE : redactJsonValue(item),
		]),
	);
}

function redactChange(change: UpgradeFieldChange): UpgradeFieldChange {
	const redactWholeChange = change.valueKind === "secret";
	const redactValue = (value: JsonValue | undefined) => {
		if (value === undefined) {
			return undefined;
		}
		if (redactWholeChange) {
			return REDACTED_VALUE;
		}
		if (SECRET_KEY_PATTERN.test(change.path) && typeof value !== "object") {
			return REDACTED_VALUE;
		}
		return redactJsonValue(value);
	};

	return {
		...change,
		before: redactValue(change.before),
		after: redactValue(change.after),
	};
}

export function toPublicUpgradePlan(plan: UpgradePlan): PublicUpgradePlan {
	return {
		...plan,
		applicationUpgrades: plan.applicationUpgrades.map((step) => ({
			...step,
			summary: step.summary ? redactJsonValue(step.summary) : step.summary,
		})),
		configChanges: plan.configChanges.map((change) => redactChange(change)),
		dbSettingChanges: plan.dbSettingChanges.map((change) =>
			redactChange(change),
		),
	};
}
