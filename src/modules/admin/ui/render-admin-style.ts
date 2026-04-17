export function renderAdminStyle(): string {
	return `
:root {
	color-scheme: light;
	font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
	background: #eef2f7;
	color: #111827;
}

* {
	box-sizing: border-box;
}

body {
	margin: 0;
	background: #eef2f7;
	color: #111827;
}

button,
input,
select,
textarea {
	font: inherit;
}

button {
	cursor: pointer;
}

.admin-login {
	min-height: 100vh;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 24px;
}

.admin-login-panel,
.admin-panel,
.admin-stat {
	background: #ffffff;
	border: 1px solid rgba(17, 24, 39, 0.08);
	border-radius: 8px;
	box-shadow: 0 12px 30px rgba(17, 24, 39, 0.08);
}

.admin-login-panel {
	width: min(100%, 420px);
	padding: 24px;
}

.admin-login-panel h1 {
	margin: 0 0 8px;
	font-size: 28px;
}

.admin-subtitle {
	margin: 0 0 20px;
	color: #4b5563;
	font-size: 14px;
	line-height: 1.6;
}

.admin-form-grid {
	display: grid;
	gap: 14px;
}

.admin-form-field {
	display: grid;
	gap: 8px;
}

.admin-form-field label {
	font-size: 14px;
	font-weight: 600;
}

.admin-field-help {
	color: #6b7280;
	font-size: 13px;
	line-height: 1.6;
}

.admin-form-field input,
.admin-form-field select,
.admin-form-field textarea {
	width: 100%;
	border: 1px solid rgba(17, 24, 39, 0.16);
	border-radius: 8px;
	padding: 10px 12px;
	background: #fff;
}

.admin-form-field textarea {
	min-height: 88px;
	resize: vertical;
}

.admin-login-actions,
.admin-toolbar-actions {
	display: flex;
	gap: 10px;
	flex-wrap: wrap;
}

.admin-checkbox-list {
	display: grid;
	gap: 10px;
}

.admin-check-option {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
	padding: 10px 12px;
	border: 1px solid rgba(17, 24, 39, 0.08);
	border-radius: 8px;
	background: rgba(255, 255, 255, 0.04);
}

.admin-check-option-copy {
	display: grid;
	gap: 4px;
}

.admin-check-option-title {
	font-size: 14px;
	font-weight: 600;
	color: #111827;
}

.admin-check-option-description {
	font-size: 13px;
	line-height: 1.6;
	color: #6b7280;
}

.admin-toggle-field {
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: start;
	gap: 14px;
	padding: 10px 12px;
	border: 1px solid rgba(17, 24, 39, 0.08);
	border-radius: 8px;
	background: rgba(255, 255, 255, 0.04);
}

.admin-toggle-copy {
	display: grid;
	gap: 4px;
}

.admin-toggle-title {
	font-size: 14px;
	font-weight: 600;
}

.admin-toggle-key {
	color: #6b7280;
	font-size: 12px;
}

.admin-toggle-description {
	margin: 0;
	color: #6b7280;
	font-size: 13px;
	line-height: 1.6;
}

.admin-switch {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	white-space: nowrap;
	align-self: center;
}

.admin-switch input,
.admin-check-option input {
	margin: 0;
	width: 16px;
	height: 16px;
}

.admin-switch-text {
	font-size: 13px;
	color: #6b7280;
}

.admin-table a {
	color: #111827;
}

.admin-button-primary,
.admin-button-secondary,
.admin-button-danger,
.admin-tab {
	border: 0;
	border-radius: 8px;
	padding: 10px 14px;
}

.admin-button-primary {
	background: #111827;
	color: #fff;
}

.admin-button-secondary,
.admin-tab {
	background: #e5e7eb;
	color: #111827;
}

.admin-button-danger {
	background: #b91c1c;
	color: #fff;
}

.admin-captcha-image {
	width: 160px;
	height: 60px;
	border-radius: 8px;
	border: 1px solid rgba(17, 24, 39, 0.12);
	background: #f9fafb;
}

.admin-message {
	margin: 0;
	padding: 10px 12px;
	border-radius: 8px;
	font-size: 14px;
	line-height: 1.6;
}

.admin-message-info {
	background: #dbeafe;
	color: #1d4ed8;
}

.admin-message-error {
	background: #fee2e2;
	color: #b91c1c;
}

.admin-shell {
	min-height: 100vh;
	display: grid;
	grid-template-columns: 240px 1fr;
}

.admin-sidebar {
	padding: 24px 18px;
	background: #111827;
	color: #f9fafb;
	display: grid;
	align-content: start;
	gap: 18px;
}

.admin-sidebar h1 {
	margin: 0;
	font-size: 24px;
}

.admin-sidebar p {
	margin: 0;
	color: rgba(249, 250, 251, 0.72);
	font-size: 13px;
	line-height: 1.6;
}

.admin-tab-list {
	display: grid;
	gap: 10px;
}

.admin-tab {
	text-align: left;
	background: rgba(255, 255, 255, 0.1);
	color: #f9fafb;
}

.admin-tab[aria-current="page"] {
	background: #f9fafb;
	color: #111827;
}

.admin-shell-main {
	padding: 24px;
	display: grid;
	gap: 18px;
	align-content: start;
}

.admin-topbar {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 16px;
	flex-wrap: wrap;
}

.admin-topbar h2 {
	margin: 0;
	font-size: 28px;
}

.admin-topbar p {
	margin: 6px 0 0;
	color: #4b5563;
	font-size: 14px;
}

.admin-topbar select {
	min-width: 220px;
	border: 1px solid rgba(17, 24, 39, 0.16);
	border-radius: 8px;
	padding: 10px 12px;
	background: #fff;
}

.admin-stat-grid {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 14px;
}

.admin-stat {
	padding: 16px;
}

.admin-stat span {
	display: block;
	font-size: 13px;
	color: #4b5563;
}

.admin-stat strong {
	display: block;
	margin-top: 8px;
	font-size: 24px;
}

.admin-panel {
	padding: 18px;
	display: grid;
	gap: 16px;
}

.admin-filter-grid,
.admin-settings-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 14px;
}

.admin-table {
	width: 100%;
	border-collapse: collapse;
}

.admin-table th,
.admin-table td {
	padding: 12px;
	border-bottom: 1px solid rgba(17, 24, 39, 0.08);
	text-align: left;
	vertical-align: top;
}

.admin-table th {
	font-size: 13px;
	color: #4b5563;
}

.admin-table td {
	font-size: 14px;
	line-height: 1.6;
}

.admin-chip {
	display: inline-block;
	padding: 4px 8px;
	border-radius: 999px;
	background: #e5e7eb;
	font-size: 12px;
}

.admin-meta {
	color: #6b7280;
	font-size: 13px;
}

.admin-empty {
	margin: 0;
	color: #6b7280;
	font-size: 14px;
}

@media (max-width: 900px) {
	.admin-shell {
		grid-template-columns: 1fr;
	}

	.admin-sidebar {
		gap: 12px;
	}

	.admin-stat-grid,
	.admin-filter-grid,
	.admin-settings-grid {
		grid-template-columns: 1fr;
	}
}
`;
}
