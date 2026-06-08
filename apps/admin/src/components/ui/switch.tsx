import type * as React from "react";
import { Switch as RadixSwitch } from "@radix-ui/themes";

function Switch({
	checked,
	onCheckedChange,
	...props
}: Omit<React.ComponentProps<typeof RadixSwitch>, "onCheckedChange"> & {
	checked: boolean;
	onCheckedChange?: (checked: boolean) => void;
}) {
	return (
		<RadixSwitch
			{...props}
			checked={checked}
			onCheckedChange={(nextChecked) => onCheckedChange?.(nextChecked)}
		/>
	);
}

export { Switch };
