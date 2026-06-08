import { AppError } from "../../shared/errors";
import {
	createIframeCaptchaChallenge,
	fetchCaptchaProviderJson,
} from "./provider-helpers";

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 140;

function toScriptLiteral(value: unknown) {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function createRecaptchaChallenge(input: {
	challengeId: string;
	siteKey: string;
	pageKey: string;
	widgetPath: string;
}) {
	return createIframeCaptchaChallenge({
		providerKind: "recaptcha",
		challengeId: input.challengeId,
		widgetPath: input.widgetPath,
		siteKey: input.siteKey,
		pageKey: input.pageKey,
		width: DEFAULT_WIDTH,
		height: DEFAULT_HEIGHT,
	});
}

export function renderRecaptchaWidgetHtml(input: {
	challengeId: string;
	commentsSiteKey: string;
	pageKey: string;
	recaptchaSiteKey: string;
	expectedAction: string;
	variant: "score_based" | "policy_based_challenge";
	completePath: string;
}) {
	const model = toScriptLiteral(input);
	const challengeHtml =
		input.variant === "policy_based_challenge"
			? `<button class="g-recaptcha" data-sitekey="${input.recaptchaSiteKey}" data-callback="onRecaptchaSubmit" data-action="${input.expectedAction}">开始验证</button>`
			: `<button id="recaptcha-trigger" type="button">开始验证</button>`;
	return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>QingYan reCAPTCHA</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #fff; color: #111; }
    .shell { min-height: 100vh; display: grid; place-items: center; padding: 12px; box-sizing: border-box; }
    .panel { width: 100%; max-width: 320px; display: grid; gap: 8px; justify-items: center; }
    .status { font-size: 12px; color: #555; text-align: center; min-height: 18px; }
    button { padding: 8px 12px; border-radius: 6px; border: 1px solid #d0d0d0; background: #fff; cursor: pointer; }
  </style>
  <script src="https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(input.recaptchaSiteKey)}" async defer></script>
</head>
<body>
  <div class="shell">
    <div class="panel">
      ${challengeHtml}
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

    async function executeScoreBased() {
      if (!window.grecaptcha?.enterprise) {
        setStatus("验证码加载失败。");
        return;
      }
      setStatus("正在获取令牌...");
      const token = await window.grecaptcha.enterprise.execute(model.recaptchaSiteKey, {
        action: model.expectedAction
      });
      await submitToken(token);
    }

    async function onRecaptchaSubmit(token) {
      await submitToken(token);
    }

    window.addEventListener("load", () => {
      if (model.variant === "score_based") {
        const trigger = document.getElementById("recaptcha-trigger");
        trigger?.addEventListener("click", () => {
          window.grecaptcha.enterprise.ready(() => {
            void executeScoreBased();
          });
        });
        return;
      }
      setStatus("点击按钮完成验证。");
    });
  </script>
</body>
</html>`;
}

export async function verifyRecaptchaToken(input: {
	projectId: string;
	apiKey: string;
	siteKey: string;
	token: string;
	expectedAction: string;
	minScore: number;
	userAgent?: string;
	userIpAddress?: string;
	expectedHostname?: string;
}) {
	const result = (await fetchCaptchaProviderJson({
		url: `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(input.projectId)}/assessments?key=${encodeURIComponent(input.apiKey)}`,
		init: {
			method: "POST",
			headers: {
				"content-type": "application/json; charset=utf-8",
			},
			body: JSON.stringify({
				event: {
					token: input.token,
					siteKey: input.siteKey,
					userAgent: input.userAgent,
					userIpAddress: input.userIpAddress,
					expectedAction: input.expectedAction,
				},
			}),
		},
	})) as {
		tokenProperties?: {
			valid?: boolean;
			action?: string;
			hostname?: string;
		};
		riskAnalysis?: {
			score?: number;
		};
	};

	if (!result.tokenProperties?.valid) {
		throw new AppError(400, "COMMENT_CAPTCHA_INVALID", "验证码校验失败。");
	}
	if (result.tokenProperties.action !== input.expectedAction) {
		throw new AppError(400, "COMMENT_CAPTCHA_INVALID", "验证码动作不匹配。");
	}
	if (
		input.expectedHostname &&
		result.tokenProperties.hostname !== input.expectedHostname
	) {
		throw new AppError(400, "COMMENT_CAPTCHA_INVALID", "验证码来源不匹配。");
	}
	if ((result.riskAnalysis?.score ?? 0) < input.minScore) {
		throw new AppError(400, "COMMENT_CAPTCHA_INVALID", "验证码风险评分过低。");
	}
}
