export const HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.68.0",
  "Editor-Version": "vscode/1.140.0",
  "Editor-Plugin-Version": "copilot-chat/0.68.0",
  "Copilot-Integration-Id": "vscode-chat",
};

export function normalizeDomain(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("GitHub host is required");
  }
  const input = value.trim();
  const url = new URL(input.includes("://") ? input : `https://${input}`);
  if (
    url.protocol !== "https:" || url.username || url.password || url.port ||
    url.search || url.hash || url.pathname !== "/" ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname)
  ) {
    throw new Error("Expected an HTTPS GitHub host without credentials, port or path");
  }
  return url.hostname;
}

export function getUrls(domain = "github.com") {
  const host = normalizeDomain(domain);
  const api = `https://api.${host}`;
  return {
    DEVICE_CODE_URL: `https://${host}/login/device/code`,
    ACCESS_TOKEN_URL: `https://${host}/login/oauth/access_token`,
    COPILOT_API_KEY_URL: `${api}/copilot_internal/v2/token`,
    USER_URL: `${api}/copilot_internal/user`,
  };
}
