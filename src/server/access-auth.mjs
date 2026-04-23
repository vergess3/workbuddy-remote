import crypto from "node:crypto";

import { json, text } from "../shared.mjs";
import { validatePasswordHashFormat, verifyPasswordHash } from "./password-hash.mjs";

const LOGIN_PATH = "/login";
const LOGOUT_PATH = "/logout";
const SESSION_COOKIE_NAME = "workbuddy_remote_session";
const SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const SESSION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

function getLoginPageStrings(locale) {
  const normalizedLocale = String(
    locale || process.env.WORKBUDDY_REMOTE_UI_LANG || Intl.DateTimeFormat().resolvedOptions().locale
  ).toLowerCase();

  if (normalizedLocale.startsWith("zh")) {
    return {
      lang: "zh-CN",
      title: "WorkBuddy Remote 登录",
      heading: "WorkBuddy Remote",
      hint: "请输入桥接访问密码以继续。",
      passwordLabel: "密码",
      continueLabel: "继续",
      incorrectPassword: "密码不正确。",
    };
  }

  return {
    lang: "en",
    title: "WorkBuddy Remote Login",
    heading: "WorkBuddy Remote",
    hint: "Enter the bridge password to continue.",
    passwordLabel: "Password",
    continueLabel: "Continue",
    incorrectPassword: "Password is incorrect.",
  };
}

function getRequestLocale(req) {
  const acceptLanguage = typeof req.headers["accept-language"] === "string"
    ? req.headers["accept-language"]
    : "";
  const firstLocale = acceptLanguage.split(",")[0]?.trim();
  return firstLocale || process.env.WORKBUDDY_REMOTE_UI_LANG || Intl.DateTimeFormat().resolvedOptions().locale;
}

function parseCookies(cookieHeader) {
  const cookies = new Map();
  const headerValue = typeof cookieHeader === "string" ? cookieHeader : "";
  for (const part of headerValue.split(";")) {
    const segment = part.trim();
    if (!segment) {
      continue;
    }

    const separatorIndex = segment.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = segment.slice(0, separatorIndex).trim();
    const value = segment.slice(separatorIndex + 1).trim();
    if (key) {
      cookies.set(key, decodeURIComponent(value));
    }
  }
  return cookies;
}

function readUtf8Body(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function normalizeNextPath(nextPath) {
  const rawValue = typeof nextPath === "string" ? nextPath.trim() : "";
  if (!rawValue || !rawValue.startsWith("/") || rawValue.startsWith("//")) {
    return "/agent-manager/";
  }
  return rawValue;
}

function requestAcceptsHtml(req) {
  const acceptHeader = typeof req.headers.accept === "string" ? req.headers.accept : "";
  return acceptHeader.includes("text/html");
}

function shouldRedirectToLogin(req, requestUrl) {
  const destination = typeof req.headers["sec-fetch-dest"] === "string" ? req.headers["sec-fetch-dest"] : "";
  if (destination === "document") {
    return true;
  }

  if (requestUrl.pathname.startsWith("/bridge/") || requestUrl.pathname.startsWith("/mirror/")) {
    return false;
  }

  return requestAcceptsHtml(req);
}

function isSecureRequest(req) {
  if (req.socket?.encrypted) {
    return true;
  }

  const forwardedProto = req.headers["x-forwarded-proto"];
  const values = Array.isArray(forwardedProto) ? forwardedProto : [forwardedProto];
  return values.some((value) => typeof value === "string" && value.includes("https"));
}

function buildCookie(value, req, maxAgeSeconds) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecureRequest(req)) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

function renderLoginPage({ locale, errorMessage = "", nextPath = "/agent-manager/" }) {
  const strings = getLoginPageStrings(locale);
  const errorHtml = errorMessage
    ? `<p class="error">${escapeHtml(errorMessage)}</p>`
    : `<p class="hint">${escapeHtml(strings.hint)}</p>`;

  return `<!doctype html>
<html lang="${strings.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(strings.title)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", "PingFang SC", sans-serif;
      }
      @media (hover: none) and (pointer: coarse) {
        input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="hidden"]),
        textarea,
        select,
        [contenteditable="true"],
        [role="textbox"] {
          font-size: 16px;
        }
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, #f8fbff 0%, #eef3ff 45%, #e9eef7 100%);
        color: #1f2937;
      }
      main {
        width: min(420px, calc(100vw - 32px));
        padding: 28px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
      }
      h1 {
        margin: 0 0 10px;
        font-size: 24px;
      }
      p {
        margin: 0 0 16px;
        line-height: 1.5;
      }
      label {
        display: block;
        margin-bottom: 8px;
        font-weight: 600;
      }
      input[type="password"] {
        width: 100%;
        padding: 12px 14px;
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        font-size: 15px;
        box-sizing: border-box;
      }
      button {
        width: 100%;
        margin-top: 14px;
        padding: 12px 14px;
        border: 0;
        border-radius: 12px;
        background: #0f172a;
        color: #ffffff;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
      }
      .hint {
        color: #475569;
      }
      .error {
        color: #b91c1c;
        background: #fef2f2;
        border-radius: 12px;
        padding: 12px 14px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(strings.heading)}</h1>
      ${errorHtml}
      <form method="post" action="${LOGIN_PATH}">
        <input type="hidden" name="next" value="${escapeHtml(nextPath)}" />
        <label for="password">${escapeHtml(strings.passwordLabel)}</label>
        <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
        <button type="submit">${escapeHtml(strings.continueLabel)}</button>
      </form>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

class BridgeAccessAuth {
  constructor(passwordHash) {
    this.passwordHash = validatePasswordHashFormat(passwordHash);
    this.sessions = new Map();
    this.lastCleanupAt = 0;
  }

  get enabled() {
    return Boolean(this.passwordHash);
  }

  shouldBypass(pathname) {
    return (
      pathname === "/healthz" ||
      pathname === "/readyz" ||
      pathname === LOGIN_PATH ||
      pathname === LOGOUT_PATH
    );
  }

  getSession(req) {
    this.cleanupExpiredSessions();
    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE_NAME);
    if (!token) {
      return null;
    }

    const expiresAt = this.sessions.get(token);
    if (!expiresAt || expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }

    this.sessions.set(token, Date.now() + SESSION_TTL_MS);
    return token;
  }

  isAuthenticated(req) {
    return Boolean(this.getSession(req));
  }

  async handleRequest(req, res, requestUrl) {
    if (!this.enabled) {
      return false;
    }

    if (requestUrl.pathname === LOGIN_PATH) {
      await this.handleLoginRoute(req, res, requestUrl);
      return true;
    }

    if (requestUrl.pathname === LOGOUT_PATH) {
      this.handleLogout(req, res);
      return true;
    }

    if (this.shouldBypass(requestUrl.pathname) || this.isAuthenticated(req)) {
      return false;
    }

    if (req.method === "GET" && shouldRedirectToLogin(req, requestUrl)) {
      const nextPath = normalizeNextPath(`${requestUrl.pathname}${requestUrl.search}`);
      res.writeHead(302, {
        Location: `${LOGIN_PATH}?next=${encodeURIComponent(nextPath)}`,
        "Cache-Control": "no-store",
      });
      res.end();
      return true;
    }

    json(res, 401, {
      ok: false,
      error: "Authentication required.",
      loginPath: LOGIN_PATH,
    });
    return true;
  }

  handleUpgrade(req, socket) {
    if (!this.enabled || this.isAuthenticated(req)) {
      return true;
    }

    socket.write(
      "HTTP/1.1 401 Unauthorized\r\n" +
        "Content-Type: text/plain; charset=utf-8\r\n" +
        "Cache-Control: no-store\r\n" +
        "Connection: close\r\n\r\nAuthentication required."
    );
    socket.destroy();
    return false;
  }

  async handleLoginRoute(req, res, requestUrl) {
    const locale = getRequestLocale(req);
    const strings = getLoginPageStrings(locale);

    if (req.method === "GET") {
      if (this.isAuthenticated(req)) {
        res.writeHead(302, {
          Location: normalizeNextPath(requestUrl.searchParams.get("next")),
          "Cache-Control": "no-store",
        });
        res.end();
        return;
      }

      text(
        res,
        200,
        renderLoginPage({
          locale,
          nextPath: normalizeNextPath(requestUrl.searchParams.get("next")),
        }),
        "text/html; charset=utf-8"
      );
      return;
    }

    if (req.method !== "POST") {
      json(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    const body = await readUtf8Body(req);
    const formData = new URLSearchParams(body);
    const password = formData.get("password") || "";
    const nextPath = normalizeNextPath(formData.get("next") || requestUrl.searchParams.get("next"));

    if (!verifyPasswordHash(password, this.passwordHash.rawValue)) {
      text(
        res,
        401,
        renderLoginPage({
          locale,
          errorMessage: strings.incorrectPassword,
          nextPath,
        }),
        "text/html; charset=utf-8"
      );
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    this.sessions.set(token, Date.now() + SESSION_TTL_MS);
    this.cleanupExpiredSessions();

    res.writeHead(303, {
      Location: nextPath,
      "Set-Cookie": buildCookie(token, req, Math.floor(SESSION_TTL_MS / 1000)),
      "Cache-Control": "no-store",
    });
    res.end();
  }

  handleLogout(req, res) {
    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE_NAME);
    if (token) {
      this.sessions.delete(token);
    }

    res.writeHead(303, {
      Location: LOGIN_PATH,
      "Set-Cookie": buildCookie("", req, 0),
      "Cache-Control": "no-store",
    });
    res.end();
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    if (now - this.lastCleanupAt < SESSION_CLEANUP_INTERVAL_MS) {
      return;
    }

    for (const [token, expiresAt] of this.sessions.entries()) {
      if (expiresAt <= now) {
        this.sessions.delete(token);
      }
    }
    this.lastCleanupAt = now;
  }
}

function createBridgeAccessAuth(passwordHash) {
  return new BridgeAccessAuth(passwordHash);
}

export { LOGIN_PATH, LOGOUT_PATH, createBridgeAccessAuth };
