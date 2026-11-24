import { execFileSync } from "node:child_process";
import {
  chmod, copyFile, mkdtemp, readFile, rm, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "rolldown";

const root = fileURLToPath(new URL("../", import.meta.url));
const { name, version, description, license, type, engines, bin, dependencies } =
  JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const manifest = {
  name, version, description, license, type, engines, bin, dependencies,
};
const publicPackages = Object.keys(dependencies);
const stage = await mkdtemp(join(tmpdir(), "mie-mcp-pack-"));

try {
  await build({
    cwd: root,
    platform: "node",
    input: ["src/index.ts", "src/screenshot-writer.ts"],
    external: (id) => publicPackages.some(
      (pkg) => id === pkg || id.startsWith(pkg + "/"),
    ),
    onwarn(warning, warn) {
      if (warning.code === "UNRESOLVED_IMPORT") throw new Error(warning.message);
      warn(warning);
    },
    output: { dir: join(stage, "dist"), format: "esm", minify: true },
  });
  await chmod(join(stage, bin["mie-mcp"]), 0o755);
  await copyFile(join(root, "README.md"), join(stage, "README.md"));
  await copyFile(join(root, "LICENSE"), join(stage, "LICENSE"));
  await copyFile(
    join(root, "LICENSE-tool-defs"), join(stage, "LICENSE-tool-defs"),
  );
  await writeFile(
    join(stage, "package.json"), JSON.stringify(manifest, null, 2) + "\n",
  );
  execFileSync("npm", [
    "pack", "--offline", "--ignore-scripts", "--pack-destination", root,
  ], { cwd: stage, stdio: "inherit" });
} finally {
  await rm(stage, { recursive: true, force: true });
}
