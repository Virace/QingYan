import { AppError } from "../../shared/errors";

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 120;

function toScriptLiteral(value: unknown) {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function createTurnstileChallenge(input: {
	challengeId: string;
	siteKey: string;
	pageKey: string;
	widgetPath: string;
}) {
	const publicChallenge = {
		challengeId: input.challengeId,
		mode: "iframe_widget" as const,
		iframeSrc: `${input.widgetPath}?siteKey=${encodeURIComponent(input.siteKey)}&pageKey=${encodeURIComponent(input.pageKey)}&challengeId=${encodeURIComponent(input.challengeId)}`,
		width: DEFAULT_WIDTH,
		height: DEFAULT_HEIGHT,
	};
	return {
		mode: "iframe_widget" as const,
		providerKind: "turnstile" as const,
		challengePayloadJson: JSON.stringify({
			publicChallenge,
		}),
		publicChallenge,
		expiresAt: "",
	};
}

export function renderTurnstileWidgetHtml(input: {
	challengeId: string;
	commentsSiteKey: string;
	pageKey: string;
	turnstileSiteKey: string;
	completePath: string;
	expectedAction?: string;
}) {
	const model = toScriptLiteral(input);
	return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>QingYan Turnstile</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #fff; color: #111; }
    .shell { min-height: 100vh; display: grid; place-items: center; padding: 12px; box-sizing: border-box; }
    .panel { width: 100%; max-width: 320px; display: grid; gap: 8px; justify-items: center; }
    .status { font-size: 12px; color: #555; text-align: center; min-height: 18px; }
  </style>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>
</head>
<body>
  <div class="shell">
    <div class="panel">
      <div id="turnstile-widget"></div>
      <div id="status" class="status">等待验证...</div>
    </div>
  </div>
  <script>
    const model = ${model};
    const statusEl = document.getElementById("status");

    function setStatus(text) {
      statusEl.textContent = text;
    }

    async function submitToken(token) {
      setStatus("正在校验...");
      const response = await fetch(model.completePath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteKey: model.commentsSiteKey,
          pageKey: model.pageKey,
          challengeId: model.challengeId,
          token
        })
      });

      if (!response.ok) {
        setStatus("校验失败，请重试。");
        return;
      }

      setStatus("验证通过");
      window.parent?.postMessage(
        { type: "qingyan-captcha", status: "verified", challengeId: model.challengeId },
        window.location.origin
      );
    }

    window.addEventListener("load", () => {
      if (!window.turnstile) {
        setStatus("验证码加载失败。");
        return;
      }
      window.turnstile.render("#turnstile-widget", {
        sitekey: model.turnstileSiteKey,
        action: model.expectedAction,
        callback: submitToken,
        "error-callback": () => setStatus("验证码加载失败。")
      });
    });
  </script>
</body>
</html>`;
}

export async function verifyTurnstileToken(input: {
	secretKey: string;
	token: string;
	remoteIp?: string;
	expectedAction?: string;
	expectedHostname?: string;
}) {
	const body = new URLSearchParams({
		secret: input.secretKey,
		response: input.token,
	});
	if (input.remoteIp) {
		body.set("remoteip", input.remoteIp);
	}

	let response: Response;
	try {
		response = await fetch(
			"https://challenges.cloudflare.com/turnstile/v0/siteverify",
			{
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded",
				},
				body,
			},
		);
	} catch {
		throw new AppError(
			502,
			"CAPTCHA_PROVIDER_UNAVAILABLE",
			"验证码服务暂时不可用。",
		);
	}

	if (!response.ok) {
		throw new AppError(
			502,
			"CAPTCHA_PROVIDER_UNAVAILABLE",
			"验证码服务暂时不可用。",
		);
	}

	const result = (await response.json()) as {
		success?: boolean;
		action?: string;
		hostname?: string;
	};

	if (!result.success) {
		throw new AppError(400, "COMMENT_CAPTCHA_INVALID", "验证码校验失败。");
	}
	if (input.expectedAction && result.action !== input.expectedAction) {
		throw new AppError(400, "COMMENT_CAPTCHA_INVALID", "验证码动作不匹配。");
	}
	if (input.expectedHostname && result.hostname !== input.expectedHostname) {
		throw new AppError(400, "COMMENT_CAPTCHA_INVALID", "验证码来源不匹配。");
	}
}
