const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const preflight = require("./release-preflight.cjs");

const repo = { owner: "Hanssen0", repo: "khie-mobile" };
function fixture(t, { version = "0.8.4", appVersion = version, versionCode = 16,
  releases = [], refs = [], failure, failAt = "releases" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "khie-preflight-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), JSON.stringify({ version }));
  writeFileSync(join(root, "app.json"), JSON.stringify({ expo: {
    version: appVersion, android: { versionCode },
  } }));
  const calls = [];
  const listReleases = () => assert.fail("Release listing must use pagination");
  const github = {
    paginate: async (method, params) => {
      assert.equal(method, listReleases);
      assert.deepEqual(params, { ...repo, per_page: 100 });
      calls.push("releases");
      if (failure && failAt === "releases") throw failure;
      return releases;
    },
    rest: {
      repos: { listReleases },
      git: { listMatchingRefs: async (params) => {
        assert.deepEqual(params, { ...repo, ref: `tags/v${version}` });
        calls.push("refs");
        if (failure && failAt === "refs") throw failure;
        return { data: refs };
      } },
    },
  };
  return { run: () => preflight({ github, context: { repo }, root }), calls };
}

test("fresh version passes with successful empty release and tag lists", async (t) => {
  const f = fixture(t);
  assert.equal(await f.run(), "v0.8.4");
  assert.deepEqual(f.calls, ["releases", "refs"]);
});

test("unrelated releases and prefix-matching tags do not occupy the version", async (t) => {
  const f = fixture(t, { releases: [{ tag_name: "v0.8.3" }],
    refs: [{ ref: "refs/tags/v0.8.40" }, { ref: "refs/tags/v0.8.4-rc.1" }] });
  assert.equal(await f.run(), "v0.8.4");
});

for (const release of [
  { immutable: true, draft: false },
  { immutable: false, draft: false },
  { immutable: false, draft: true },
]) {
  test(`existing release is rejected: ${JSON.stringify(release)}`, async (t) => {
    const f = fixture(t, { releases: [
      ...Array.from({ length: 100 }, (_, i) => ({ tag_name: `v0.7.${i}` })),
      { ...release, tag_name: "v0.8.4" },
    ] });
    await assert.rejects(f.run(), /Release v0.8.4 already exists/);
    assert.deepEqual(f.calls, ["releases"]);
  });
}

for (const type of ["commit", "tag"]) {
  test(`existing ${type} ref without a release is rejected`, async (t) => {
    const f = fixture(t, { refs: [{ ref: "refs/tags/v0.8.4", object: { type, sha: "a".repeat(40) } }] });
    await assert.rejects(f.run(), /Tag v0.8.4 already exists/);
  });
}

for (const failAt of ["releases", "refs"]) {
  for (const status of [401, 403, 404, 409, 429, 500, undefined]) {
    test(`${failAt}: HTTP ${status ?? "network failure"} propagates unchanged`, async (t) => {
      const failure = Object.assign(new Error(status ? `HTTP ${status}` : "fetch failed: ECONNRESET"), { status });
      const f = fixture(t, { failAt, failure });
      await assert.rejects(f.run(), (error) => error === failure);
      assert.deepEqual(f.calls, failAt === "releases" ? ["releases"] : ["releases", "refs"]);
    });
  }
}

for (const options of [
  { appVersion: "0.8.3" }, { version: "0.8.4-rc.1" }, { version: "0.08.4" },
  { versionCode: 0 }, { versionCode: 1.5 }, { versionCode: 2100000001 },
]) {
  test(`invalid manifest fails before API access: ${JSON.stringify(options)}`, async (t) => {
    const f = fixture(t, options);
    await assert.rejects(f.run());
    assert.deepEqual(f.calls, []);
  });
}

test("checkout manifests agree on the release and Android build versions", () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));
  const app = JSON.parse(readFileSync(join(__dirname, "../app.json"), "utf8"));
  assert.equal(pkg.version, app.expo.version);
  assert.ok(Number.isSafeInteger(app.expo.android.versionCode));
});
