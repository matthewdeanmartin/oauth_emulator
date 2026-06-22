#!/usr/bin/env node
// One-command unattended PoC runner.
//
//   1. Start the mock IdP (Node).
//   2. Start the Spring Boot API.
//   3. Wait for both health checks.
//   4. Run the Gatling simulation.
//   5. Tear everything down and exit with Gatling's exit code.
//
// No human interaction, no browser. Exits non-zero on any failure.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import process from "node:process";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const IS_WIN = process.platform === "win32";
const npmCmd = IS_WIN ? "npm.cmd" : "npm";
const mvnCmd = IS_WIN ? "mvn.cmd" : "mvn";

const IDP_HEALTH = "http://localhost:9000/health";
const API_HEALTH = "http://localhost:8080/actuator/health";

const children = [];

function start(name, cmd, args, opts = {}) {
  console.log(`\n[poc] starting ${name}: ${cmd} ${args.join(" ")}`);
  const child = spawn(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: IS_WIN, // needed for .cmd resolution on Windows
    ...opts,
  });
  child.on("exit", (code) => {
    if (code && code !== 0 && !shuttingDown) {
      console.error(`[poc] ${name} exited early with code ${code}`);
    }
  });
  children.push({ name, child });
  return child;
}

async function waitForHealth(name, url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`[poc] waiting for ${name} health (${url}) `);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log("-> UP");
        return;
      }
    } catch {
      /* not up yet */
    }
    process.stdout.write(".");
    await sleep(1000);
  }
  console.log("");
  throw new Error(`${name} did not become healthy within ${timeoutMs}ms`);
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[poc] shutting down services...");
  for (const { name, child } of children) {
    try {
      if (IS_WIN) {
        // Kill the whole process tree (mvn -> java, npm -> node).
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          shell: true,
        });
      } else {
        process.kill(-child.pid, "SIGTERM");
      }
    } catch (e) {
      console.error(`[poc] failed to stop ${name}: ${e.message}`);
    }
  }
}

process.on("SIGINT", () => { shutdown(); process.exit(130); });
process.on("SIGTERM", () => { shutdown(); process.exit(143); });

async function main() {
  // 1. Mock IdP
  start("mock-idp", npmCmd, ["--prefix", "mock-idp", "run", "dev"]);
  await waitForHealth("mock-idp", IDP_HEALTH);

  // 2. Spring Boot API (issuer-uri points at the now-running mock IdP)
  start("spring-demo", mvnCmd, ["-f", "spring-demo/pom.xml", "-q", "spring-boot:run"]);
  await waitForHealth("spring-demo", API_HEALTH);

  // 3. Gatling (blocking; its exit code is the PoC result)
  const gatling = start("gatling", mvnCmd, [
    "-f", "gatling/pom.xml",
    "-B", "gatling:test",
    "-Dgatling.simulationClass=com.example.ssopoc.SsoSimulation",
  ]);

  const code = await new Promise((resolve) => gatling.on("exit", resolve));
  console.log(`\n[poc] gatling exited with code ${code}`);
  shutdown();
  // Give kill signals a moment to propagate before the process ends.
  await sleep(1500);
  process.exit(code ?? 1);
}

main().catch((err) => {
  console.error(`\n[poc] FAILED: ${err.message}`);
  shutdown();
  setTimeout(() => process.exit(1), 1500);
});
