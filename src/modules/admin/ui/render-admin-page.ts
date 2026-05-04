import { renderAdminScript } from "./render-admin-script";
import { renderAdminStyle } from "./render-admin-style";

export function renderAdminPage(input: { basePath: string }): string {
	return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow,noarchive" />
    <title>QingYan Admin</title>
    <script>window.__QINGYAN_ADMIN__=${JSON.stringify({ basePath: input.basePath })};</script>
    <style>${renderAdminStyle()}</style>
  </head>
  <body>
    <div id="admin-root"></div>
    <script>${renderAdminScript()}</script>
  </body>
</html>`;
}
