import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const shared = {
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "neutral",
    external: ["vscode"],
    logLevel: "info",
};

const desktopCtx = await esbuild.context({
    ...shared,
    outfile: "dist/desktop/extension.js",
});

const webCtx = await esbuild.context({
    ...shared,
    outfile: "dist/web/extension.js",
});

if (watch) {
    await Promise.all([desktopCtx.watch(), webCtx.watch()]);
    console.log("watching...");
} else {
    await Promise.all([desktopCtx.rebuild(), webCtx.rebuild()]);
    await Promise.all([desktopCtx.dispose(), webCtx.dispose()]);
}
