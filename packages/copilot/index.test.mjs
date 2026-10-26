import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";
import { CopilotAuthPlugin } from "./index.mjs";
import { getUrls, normalizeDomain } from "./endpoints.mjs";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const reply = (data) => new Response(JSON.stringify(data));
const signedIn = (extra = {}) => ({
  type: "oauth", refresh: "mock-github-oauth", access: "mock-copilot-token",
  expires: Date.now() + 60000, ...extra,
});

test("one provider id, OAuth login and magpie's usage hook", async () => {
  const hooks = await CopilotAuthPlugin({ client: {} });
  assert.deepEqual(Object.keys(hooks), ["auth"]);
  assert.equal(hooks.auth.provider, "github-copilot");
  assert.equal(typeof hooks.auth.usage, "function");
  assert.equal(typeof hooks.auth.loader, "function");
  assert.equal(hooks.auth.methods[0].type, "oauth");
});

test("host parsing accepts GHE domains or HTTPS origins, not credential-bearing URLs", () => {
  for (const input of ["company.ghe.com", "https://company.ghe.com/", " COMPANY.GHE.COM "]) {
    assert.equal(normalizeDomain(input), "company.ghe.com");
  }
  for (const input of ["", undefined, "http://company.ghe.com", "https://user@company.ghe.com",
    "https://company.ghe.com/path", "https://company.ghe.com?x=1", "https://company.ghe.com#x",
    "https://company.ghe.com:8443", "https://localhost"]) {
    assert.throws(() => normalizeDomain(input));
  }
  assert.equal(getUrls().USER_URL, "https://api.github.com/copilot_internal/user");
  assert.equal(getUrls("company.ghe.com").USER_URL,
    "https://api.company.ghe.com/copilot_internal/user");
});

test("loader preserves public and Enterprise inference origins and zero token pricing", async () => {
  for (const [enterpriseUrl, baseURL] of [
    [undefined, "https://api.githubcopilot.com"],
    ["company.ghe.com", "https://copilot-api.company.ghe.com"],
  ]) {
    globalThis.fetch = async () => assert.fail("loader must not make a model request");
    const hooks = await CopilotAuthPlugin({ client: {} });
    const provider = { models: { mock: { cost: { input: 1, output: 2 } } } };
    const loader = await hooks.auth.loader(async () => signedIn({ enterpriseUrl }), provider);
    assert.equal(loader.baseURL, baseURL);
    assert.equal(loader.apiKey, "");
    assert.deepEqual(provider.models.mock.cost,
      { input: 0, output: 0, cache: { read: 0, write: 0 } });
  }
});

test("request signing preserves body, initiator and vision headers without a quota request", async () => {
  for (const [body, initiator, vision] of [
    [{ messages: [{ role: "user", content: "hello" }] }, "user", false],
    [{ messages: [{ role: "tool", content: "done" }] }, "agent", false],
    [{ input: [{ type: "function_call_output", output: "done" }] }, "agent", false],
    [{ input: [{ role: "user", content: [{ type: "input_image", image_url: "mock" }] }] }, "user", true],
  ]) {
    const seen = [];
    const saved = [];
    globalThis.fetch = async (url, init) => {
      seen.push({ url, init });
      return new Response("mock-ok");
    };
    const hooks = await CopilotAuthPlugin({ client: { auth: { set: async (v) => saved.push(v) } } });
    const loader = await hooks.auth.loader(async () => signedIn(), { models: {} });
    const result = await loader.fetch("https://api.githubcopilot.com/responses", {
      method: "POST", headers: { authorization: "wrong", "x-api-key": "wrong" },
      body: JSON.stringify(body),
    });
    assert.equal(await result.text(), "mock-ok");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].init.headers.Authorization, "Bearer mock-copilot-token");
    assert.equal(seen[0].init.headers.authorization, undefined);
    assert.equal(seen[0].init.headers["x-api-key"], undefined);
    assert.equal(seen[0].init.headers["X-Initiator"], initiator);
    assert.equal(seen[0].init.headers["Copilot-Vision-Request"], vision ? "true" : undefined);
    assert.equal(seen[0].init.body, JSON.stringify(body));
    assert.deepEqual(saved, []);
  }
});

test("refresh saves public and Enterprise tokens under the hook's provider id", async () => {
  for (const enterpriseUrl of [undefined, "company.ghe.com"]) {
    const auth = signedIn({ access: "", expires: 0, enterpriseUrl });
    const saved = [];
    const seen = [];
    const expires = Math.floor(Date.now() / 1000) + 3600;
    globalThis.fetch = async (url, init) => {
      seen.push({ url, init });
      if (url.endsWith("/copilot_internal/v2/token")) return reply({ token: "mock-new-token", expires_at: expires });
      return new Response("mock-ok");
    };
    const hooks = await CopilotAuthPlugin({ client: { auth: { set: async (v) => saved.push(v) } } });
    const loader = await hooks.auth.loader(async () => ({ ...auth }), { models: {} });
    await loader.fetch(`${loader.baseURL}/responses`, { body: "{}", headers: {} });
    assert.equal(seen.length, 2);
    assert.equal(seen[0].url, getUrls(enterpriseUrl).COPILOT_API_KEY_URL);
    assert.equal(seen[0].init.headers.Authorization, "Bearer mock-github-oauth");
    assert.equal(seen[1].init.headers.Authorization, "Bearer mock-new-token");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].path.id, "github-copilot");
    assert.equal(saved[0].body.enterpriseUrl, enterpriseUrl);
    assert.equal(saved[0].body.expires, expires * 1000 - 300000);
    assert.equal(saved[0].body.refresh, "mock-github-oauth");
  }
});

test("device flow keeps Enterprise metadata without redirecting auth to another provider", async () => {
  for (const [inputs, host] of [
    [{}, "github.com"],
    [{ deploymentType: "enterprise", enterpriseUrl: "https://company.ghe.com/" }, "company.ghe.com"],
  ]) {
    const seen = [];
    globalThis.fetch = async (url, init) => {
      seen.push({ url, body: JSON.parse(init.body) });
      if (url.endsWith("/login/device/code")) return reply({
        verification_uri: `https://${host}/login/device`, user_code: "MOCK-CODE",
        device_code: "mock-device-code", interval: 1,
      });
      return reply({ access_token: "mock-github-oauth" });
    };
    const hooks = await CopilotAuthPlugin({ client: {} });
    const flow = await hooks.auth.methods[0].authorize(inputs);
    const result = await flow.callback();
    assert.equal(flow.url, `https://${host}/login/device`);
    assert.equal(result.type, "success");
    assert.equal(result.provider, undefined);
    assert.equal(result.refresh, "mock-github-oauth");
    assert.equal(result.enterpriseUrl, host === "github.com" ? undefined : host);
    assert.equal(seen[0].url, `https://${host}/login/device/code`);
    assert.equal(seen[1].url, `https://${host}/login/oauth/access_token`);
    assert.equal(seen[1].body.device_code, "mock-device-code");
  }
});
