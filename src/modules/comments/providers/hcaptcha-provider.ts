import { AppError } from "../../shared/errors";

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 140;

function toScriptLiteral(value: unknown) {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function createHCaptchaChallenge(input: {
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
		providerKind: "hcaptcha" as const,
		challengePayloadJson: JSON.stringify({
			publicChallenge,
		}),
		publicChallenge,
		expiresAt: "",
	};
}

export function renderHCaptchaWidgetHtml(input: {
	challengeId: string;
	commentsSiteKey: string;
	pageKey: string;
	hcaptchaSiteKey: string;
	completePath: string;
}) {
	const model = toScriptLiteral(input);
	return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>QingYan hCaptcha</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #fff; color: #111; }
    .shell { min-height: 100vh; display: grid; place-items: center; padding: 12px; box-sizing: border-box; }
    .panel { width: 100%; max-width: 320px; display: grid; gap: 8px; justify-items: center; }
    .status { font-size: 12px; color: #555; text-align: center; min-height: 18px; }
  </style>
  <script src="https://js.hcaptcha.com/1/api.js?onload=onloadHCaptcha&render=explicit" async defer></script>
</head>
<body>
  <div class="shell">
    <div class="panel">
      <div id="hcaptcha-widget"></div>
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

    function onloadHCaptcha() {
      if (!window.hcaptcha) {
        setStatus("验证码加载失败。");
        return;
      }
      window.hcaptcha.render("hcaptcha-widget", {
        sitekey: model.hcaptchaSiteKey,
        callback: submitToken,
        "error-callback": () => setStatus("验证码加载失败。"),
        "expired-callback": () => setStatus("验证码已过期，请重试。")
      });
    }
  </script>
</body>
</html>`;
}

export async function verifyHCaptchaToken(input: {
	secretKey: string;
	siteKey: string;
	token: string;
	remoteIp?: string;
	expectedHostname?: string;
}) {
	const body = new URLSearchParams({
		secret: input.secretKey,
		response: input.token,
		sitekey: input.siteKey,
	});
	if (input.remoteIp) {
		body.set("remoteip", input.remoteIp);
	}

	let response: Response;
	try {
		response = await fetch("https://api.hcaptcha.com/siteverify", {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
			},
			body,
		});
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
		hostname?: string;
	};
	if (!result.success) {
		throw new AppError(400, "COMMENT_CAPTCHA_INVALID", "验证码校验失败。");
	}
	if (input.expectedHostname && result.hostname !== input.expectedHostname) {
		throw new AppError(400, "COMMENT_CAPTCHA_INVALID", "验证码来源不匹配。");
	}
}
