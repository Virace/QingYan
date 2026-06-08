import type { ServiceState } from "../service-control/systemd-service";
import { SystemdServiceController } from "../service-control/systemd-service";
import type { ServiceControlController } from "../service-control/systemd-service";

export const serviceRestartConfirmation = "RESTART QINGYAN";
export const defaultServiceUnit = "qingyan.service";

export type AdminServiceControlMode = "disabled" | "systemd";

export interface AdminServiceControl {
	enabled: boolean;
	mode: AdminServiceControlMode;
	unit: string;
	controller?: ServiceControlController;
}

export interface AdminServiceControlStatus {
	enabled: boolean;
	mode: AdminServiceControlMode;
	unit: string;
	state: ServiceState;
	restart: {
		confirmation: typeof serviceRestartConfirmation;
	};
}

export function resolveAdminServiceControl(input: {
	env?: NodeJS.ProcessEnv;
	injected?: ServiceControlController;
}): AdminServiceControl {
	if (input.injected) {
		return {
			enabled: true,
			mode: "systemd",
			unit: defaultServiceUnit,
			controller: input.injected,
		};
	}

	const env = input.env ?? process.env;
	if (env.QINGYAN_ADMIN_SERVICE_CONTROL !== "systemd") {
		return {
			enabled: false,
			mode: "disabled",
			unit: defaultServiceUnit,
		};
	}

	return {
		enabled: true,
		mode: "systemd",
		unit: defaultServiceUnit,
		controller: new SystemdServiceController({
			unit: defaultServiceUnit,
		}),
	};
}

export async function getServiceControlStatus(
	control: AdminServiceControl,
): Promise<AdminServiceControlStatus> {
	return {
		enabled: control.enabled,
		mode: control.mode,
		unit: control.unit,
		state: control.controller ? await control.controller.status() : "unknown",
		restart: {
			confirmation: serviceRestartConfirmation,
		},
	};
}
