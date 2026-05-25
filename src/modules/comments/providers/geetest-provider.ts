import { createHmac } from "node:crypto";

import { AppError } from "../../shared/errors";

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 360;

function toScriptLiteral(value: unknown) {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function createGeeTestChallenge(input: {
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
		providerKind: "geetest" as const,
		challengePayloadJson: JSON.stringify({
			publicChallenge,
		}),
		publicChallenge,
		expiresAt: "",
	};
}

export function renderGeeTestWidgetHtml(input: {
	challengeId: string;
	commentsSiteKey: string;
	pageKey: string;
	captchaId: string;
	completePath: string;
}) {
	const model = toScriptLiteral(input);
	return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>QingYan GeeTest</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #fff; color: #111; }
    .shell { min-height: 100vh; display: grid; place-items: center; padding: 12px; box-sizing: border-box; }
    .panel { width: 100%; max-width: 320px; display: grid; gap: 8px; justify-items: center; }
    .status { font-size: 12px; color: #555; text-align: center; min-height: 18px; }
  </style>
  <script src="https://static.geetest.com/v4/gt4.js"></script>
</head>
<body>
  <div class="shell">
    <div class="panel">
      <div id="captcha-root"></div>
      <div id="status" class="status">等待验证...</div>
    </div>
  </div>
  <script>
    const model = ${model};
    const statusEl = document.getElementById("status");

    function setStatus(text) {
      statusEl.textContent = text;
    }

    async function submitResult(result) {
      setStatus("正在校验...");
      const response = await fetch(model.completePath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteKey: model.commentsSiteKey,
          pageKey: model.pageKey,
          challengeId: model.challengeId,
          lotNumber: result.lot_number,
          captchaOutput: result.captcha_output,
          passToken: result.pass_token,
          genTime: result.gen_time
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
      if (!window.initGeetest4) {
        setStatus("验证码加载失败。");
        return;
      }
      window.initGeetest4(
        { captchaId: model.captchaId },
        function (captcha) {
          captcha.appendTo("#captcha-root");
          captcha.onSuccess(function () {
            const result = captcha.getValidate();
            void submitResult(result);
          });
        }
      );
    });
  </script>
</body>
</html>`;
}

export async function verifyGeeTestToken(input: {
	apiServer: string;
	captchaId: string;
	captchaKey: string;
	lotNumber: string;
	captchaOutput: string;
	passToken: string;
	genTime: string;
}) {
	const signToken = createHmac("sha256", input.captchaKey)
		.update(input.lotNumber)
		.digest("hex");
	const body = new URLSearchParams({
		lot_number: input.lotNumber,
		captcha_output: input.captchaOutput,
		pass_token: input.passToken,
		gen_time: input.genTime,
		sign_token: signToken,
	});

	let response: Response;
	try {
		response = await fetch(
			`${input.apiServer.replace(/\/$/, "")}/validate?captcha_id=${encodeURIComponent(input.captchaId)}`,
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
		result?: string;
	};
	if (result.result !== "success") {
		throw new AppError(400, "COMMENT_CAPTCHA_INVALID", "验证码校验失败。");
	}
}
