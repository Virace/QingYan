import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { Theme } from "@radix-ui/themes";

export type AdminThemePreference = "light" | "dark" | "system";
export type AdminResolvedTheme = "light" | "dark";

const ADMIN_THEME_STORAGE_KEY = "qingyan.admin.theme";
const themePreferences = new Set<AdminThemePreference>([
	"light",
	"dark",
	"system",
]);
const darkSchemeQuery = "(prefers-color-scheme: dark)";

interface AdminThemeContextValue {
	preference: AdminThemePreference;
	resolvedTheme: AdminResolvedTheme;
	setPreference: (preference: AdminThemePreference) => void;
}

const AdminThemeContext = createContext<AdminThemeContextValue | null>(null);

function isThemePreference(
	value: string | null,
): value is AdminThemePreference {
	return value !== null && themePreferences.has(value as AdminThemePreference);
}

function readStoredThemePreference(): AdminThemePreference {
	if (typeof window === "undefined") {
		return "system";
	}
	try {
		const value = window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY);
		return isThemePreference(value) ? value : "system";
	} catch {
		return "system";
	}
}

function writeStoredThemePreference(preference: AdminThemePreference): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, preference);
	} catch {
		return;
	}
}

function systemPrefersDark(): boolean {
	if (typeof window === "undefined" || !window.matchMedia) {
		return false;
	}
	return window.matchMedia(darkSchemeQuery).matches;
}

function resolveTheme(
	preference: AdminThemePreference,
	systemDark: boolean,
): AdminResolvedTheme {
	if (preference === "system") {
		return systemDark ? "dark" : "light";
	}
	return preference;
}

export function AdminThemeProvider({ children }: { children: ReactNode }) {
	const [preference, setPreferenceState] = useState<AdminThemePreference>(() =>
		readStoredThemePreference(),
	);
	const [systemDark, setSystemDark] = useState(() => systemPrefersDark());
	const resolvedTheme = resolveTheme(preference, systemDark);

	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) {
			return;
		}
		const media = window.matchMedia(darkSchemeQuery);
		const handleChange = () => setSystemDark(media.matches);
		handleChange();
		media.addEventListener("change", handleChange);
		return () => media.removeEventListener("change", handleChange);
	}, []);

	const value = useMemo<AdminThemeContextValue>(
		() => ({
			preference,
			resolvedTheme,
			setPreference(nextPreference) {
				setPreferenceState(nextPreference);
				writeStoredThemePreference(nextPreference);
			},
		}),
		[preference, resolvedTheme],
	);

	return (
		<AdminThemeContext.Provider value={value}>
			<Theme
				accentColor="gray"
				appearance={resolvedTheme}
				grayColor="gray"
				radius="medium"
			>
				{children}
			</Theme>
		</AdminThemeContext.Provider>
	);
}

export function useAdminTheme() {
	const context = useContext(AdminThemeContext);
	if (!context) {
		throw new Error("useAdminTheme must be used within AdminThemeProvider.");
	}
	return context;
}
