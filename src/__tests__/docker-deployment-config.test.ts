import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

async function readRootFile(file: string) {
  return readFile(path.join(root, file), "utf8");
}

describe("Docker deployment configuration", () => {
  it("runs the bundled custom server and SSH WebSocket proxy in the image", async () => {
    const dockerfile = await readRootFile("Dockerfile");
    const entrypoint = await readRootFile("docker-entrypoint.sh");

    expect(dockerfile).toContain("npm run build:runtime");
    expect(dockerfile).toContain("COPY --from=builder /app/dist ./dist");
    expect(dockerfile).toContain('CMD ["./docker-entrypoint.sh"]');
    expect(dockerfile).not.toContain('CMD ["node", "server.js"]');
    expect(dockerfile).not.toContain(".next/standalone");
    expect(entrypoint).toContain("node dist/server.js");
    expect(entrypoint).toContain("node dist/ssh-ws-proxy.js");
    expect(entrypoint).toContain("./node_modules/.bin/prisma migrate deploy");
    expect(entrypoint).not.toContain("wait -n");
  });

  it("defines container-native database, WebSocket, and healthcheck settings", async () => {
    const compose = await readRootFile("docker-compose.yml");

    expect(compose).toContain("DATABASE_URL: postgresql://");
    expect(compose).toContain("POSTGRES_PASSWORD");
    expect(compose).toContain("postgres:5432");
    expect(compose).not.toContain("localhost:5432");
    expect(compose).not.toContain("127.0.0.1:5432");
    expect(compose).toContain("SSH_WS_HOST: 0.0.0.0");
    expect(compose).toContain("NEXT_HOST: 0.0.0.0");
    expect(compose).toContain("SSH_WS_SECRET: ${SSH_WS_SECRET:?");
    expect(compose).toContain("AUTH_SESSION_SECRET: ${AUTH_SESSION_SECRET:?");
    expect(compose).toContain("POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?");
    expect(compose).toContain("pg_isready");
    expect(compose).toContain("/api/status");
    expect(compose).toContain("/var/run/docker.sock:/var/run/docker.sock:ro");
  });
});
