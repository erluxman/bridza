// afterPack.cjs — ad-hoc code-sign the macOS app.
//
// We ship UNSIGNED (no Apple Developer cert), but Apple Silicon (arm64)
// REQUIRES every binary to carry at least an ad-hoc signature — an arm64 app
// with no signature at all is killed by the kernel and Finder reports it as
// "damaged". electron-builder skips signing when `mac.identity` is null, so we
// apply the ad-hoc signature ourselves here (runs before the dmg/zip is built).
//
// This is NOT notarization: users still clear quarantine on first launch
// (right-click → Open, or the `xattr` line install.sh runs).
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  // --deep ad-hoc signs the app and every nested framework/helper/dylib.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  console.log(`  • ad-hoc signed ${path.basename(app)}`);
};
