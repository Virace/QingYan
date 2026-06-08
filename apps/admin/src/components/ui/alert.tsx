import type * as React from "react";
import { Callout } from "@radix-ui/themes";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva("", {
	variants: {
		variant: {
			default: "",
			destructive: "",
		},
	},
	defaultVariants: {
		variant: "default",
	},
});

type AlertProps = Omit<
	React.ComponentProps<typeof Callout.Root>,
	"color" | "variant"
> &
	VariantProps<typeof alertVariants>;

function Alert({ className, variant, ...props }: AlertProps) {
	return (
		<Callout.Root
			role="alert"
			color={variant === "destructive" ? "red" : "gray"}
			variant="surface"
			className={cn(alertVariants({ variant }), className)}
			{...props}
		/>
	);
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("mb-1 font-medium leading-none tracking-normal", className)}
			{...props}
		/>
	);
}

function AlertDescription({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("text-sm [&_p]:leading-relaxed", className)}
			{...props}
		/>
	);
}

export { Alert, AlertTitle, AlertDescription };
