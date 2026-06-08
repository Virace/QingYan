import { DropdownMenu, IconButton } from "@radix-ui/themes";
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { type AdminThemePreference, useAdminTheme } from "@/theme/admin-theme";

const themeOptions: {
	value: AdminThemePreference;
	label: string;
	description: string;
	icon: typeof SunIcon;
}[] = [
	{
		value: "system",
		label: "跟随系统",
		description: "使用浏览器或操作系统外观",
		icon: MonitorIcon,
	},
	{
		value: "light",
		label: "浅色",
		description: "始终使用浅色界面",
		icon: SunIcon,
	},
	{
		value: "dark",
		label: "深色",
		description: "始终使用深色界面",
		icon: MoonIcon,
	},
];

export function ThemeMenu() {
	const { preference, resolvedTheme, setPreference } = useAdminTheme();
	const current =
		themeOptions.find((option) => option.value === preference) ??
		themeOptions[0];
	const CurrentIcon = current.icon;

	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				<IconButton
					type="button"
					variant="outline"
					color="gray"
					aria-label={`主题：${current.label}，当前界面为${
						resolvedTheme === "dark" ? "深色" : "浅色"
					}`}
				>
					<CurrentIcon aria-hidden="true" size={16} />
				</IconButton>
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				{themeOptions.map((option) => {
					const Icon = option.icon;
					const selected = option.value === preference;
					return (
						<DropdownMenu.Item
							key={option.value}
							onSelect={() => setPreference(option.value)}
						>
							<Icon aria-hidden="true" size={16} />
							<span>{option.label}</span>
							<span className="sr-only">{option.description}</span>
							{selected ? <CheckIcon aria-hidden="true" size={16} /> : null}
						</DropdownMenu.Item>
					);
				})}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	);
}
