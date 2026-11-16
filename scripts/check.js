import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
async function files(dir) {
  let all = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = dir + "/" + e.name;
    all.push(...(e.isDirectory() ? await files(p) : [p]));
  }
  return all;
}
const paths = [
  "server.js",
  ...(await files("server")).filter((p) => p.endsWith(".js")),
  ...(await files("scripts")).filter((p) => p.endsWith(".js")),
];
for (let i = 0; i < paths.length; i += 4)
  await Promise.all(
    paths.slice(i, i + 4).map(
      (p) =>
        new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ["--check", p], {
            stdio: "inherit",
          });
          child.on("error", reject);
          child.on("exit", (code) =>
            code === 0 ? resolve() : reject(new Error("Erro de sintaxe: " + p)),
          );
        }),
    ),
  );
console.log(`Sintaxe verificada: ${paths.length} arquivos.`);
