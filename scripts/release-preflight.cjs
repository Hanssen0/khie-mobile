const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// Read-only snapshot: publication can still fail or race after this check.
module.exports = async function releasePreflight({ github, context, root = process.cwd() }) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const app = JSON.parse(readFileSync(join(root, "app.json"), "utf8"));
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version)) {
    throw new Error("Release version must be a stable major.minor.patch version.");
  }
  if (app.expo.version !== pkg.version) {
    throw new Error("package.json and app.json release versions must match.");
  }
  const versionCode = app.expo.android.versionCode;
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) {
    throw new Error("Android versionCode must be a positive integer <= 2100000000.");
  }

  const tag = `v${pkg.version}`;
  // Successful lists establish absence. Never interpret a rejected request
  // (including 404, which can hide inaccessible resources) as a free version.
  const releases = await github.paginate(github.rest.repos.listReleases, {
    ...context.repo,
    per_page: 100,
  });
  if (releases.some((release) => release.tag_name === tag)) {
    throw new Error(`Release ${tag} already exists. Bump the version before releasing; existing releases are not overwritten.`);
  }
  const { data: refs } = await github.rest.git.listMatchingRefs({
    ...context.repo,
    ref: `tags/${tag}`,
  });
  // The API also returns prefix matches (e.g. v0.8.40 for v0.8.4).
  if (refs.some((ref) => ref.ref === `refs/tags/${tag}`)) {
    throw new Error(`Tag ${tag} already exists. Bump the version before releasing; existing tags are not reused.`);
  }
  return tag;
};
