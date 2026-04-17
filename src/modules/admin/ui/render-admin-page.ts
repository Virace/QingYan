import { renderAdminScript } from "./render-admin-script";
import { renderAdminStyle } from "./render-admin-style";

export function renderAdminPage(): string {
	return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>QingYan Admin</title>
    <style>${renderAdminStyle()}</style>
  </head>
  <body>
    <div id="admin-root"></div>
    <script>${renderAdminScript()}</script>
  </body>
</html>`;
}
