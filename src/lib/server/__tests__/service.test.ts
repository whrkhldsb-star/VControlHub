import { beforeEach, describe, expect, it, vi } from "vitest";

import { createServerProfile, createSshKey, deleteServerProfile, listServerProfiles, setServerDirectGatewayEnabled } from "@/lib/server/service";
import { prisma } from "@/lib/db";

const { parseFromStringMock, execRemoteCommandMock } = vi.hoisted(() => ({
 parseFromStringMock: vi.fn(),
 execRemoteCommandMock: vi.fn(),
}));

vi.mock("ppk-to-openssh", () => ({
 PPKError: class PPKError extends Error {
 code: string;

 constructor(message: string, code: string) {
 super(message);
 this.name = "PPKError";
 this.code = code;
 }
 },
 parseFromString: parseFromStringMock,
}));

vi.mock("next/cache", () => ({
 revalidatePath: vi.fn(),
}));

vi.mock("@/lib/ssh/client", () => ({
 buildSshParamsFromServer: vi.fn(async (server: any, sshKey: any) => ({
  host: server.host,
  port: server.port,
  username: server.username,
  privateKey: sshKey?.privateKey ?? undefined,
  password: server.password ?? undefined,
 })),
 execRemoteCommand: execRemoteCommandMock,
}));


vi.mock("@/lib/db", () => ({
 prisma: {
 sshKey: {
 findUnique: vi.fn(),
 findMany: vi.fn(),
 create: vi.fn(),
 },
	server: {
	create: vi.fn(),
	findMany: vi.fn(),
	findFirst: vi.fn(),
	findUnique: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
	},
 storageNode: {
 findFirst: vi.fn(),
 create: vi.fn(),
 count: vi.fn(),
 updateMany: vi.fn(),
 },
 },
}));

describe("server service", () => {
 beforeEach(() => {
 process.env.STORAGE_DIRECT_ACCESS_SECRET = "test-direct-secret";
 vi.clearAllMocks();
 });

 it("creates an ssh key from manual public/private key input", async () => {
 vi.mocked(prisma.sshKey.create).mockResolvedValueOnce({
 id: "key_2",
 name: "manual-key",
 fingerprint: "SHA256:manual",
 description: null,
 } as any);

 await createSshKey({
 name: " manual-key ",
 publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE+T8dQJ1mM8AJy6K1xMAsYbwsOQJk2R4x9sQ3K9A0mE user@test",
 privateKey: " [REDACTED PRIVATE KEY] ",
 createdById: "u_1",
 });

	expect(parseFromStringMock).not.toHaveBeenCalled();
	expect(prisma.sshKey.create).toHaveBeenCalledWith(
		expect.objectContaining({
			data: expect.objectContaining({
				name: "manual-key",
				publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE+T8dQJ1mM8AJy6K1xMAsYbwsOQJk2R4x9sQ3K9A0mE user@test",
				privateKey: expect.any(String),
				createdById: "u_1",
			}),
		}),
	);
 });

 it("creates an ssh key from uploaded ppk and keeps it unencrypted when requested", async () => {
 parseFromStringMock.mockResolvedValueOnce({
 publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBPPKConverted user@test",
 privateKey: "[REDACTED PRIVATE KEY]",
 fingerprint: "SHA256:converted",
 });
 vi.mocked(prisma.sshKey.create).mockResolvedValueOnce({
 id: "key_3",
 name: "ppk-key",
 fingerprint: "SHA256:converted",
 description: null,
 } as any);

 await createSshKey({
 name: "ppk-key",
 ppkContent: "PuTTY-User-Key-File-3: ssh-ed25519\n...",
 ppkPassphrase: "source-secret",
 privateKeyEncryptionMode: "none",
 });

	expect(parseFromStringMock).toHaveBeenCalledWith("PuTTY-User-Key-File-3: ssh-ed25519\n...", "source-secret");
	expect(prisma.sshKey.create).toHaveBeenCalledWith(
		expect.objectContaining({
			data: expect.objectContaining({
				publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBPPKConverted user@test",
				privateKey: expect.any(String),
				fingerprint: "SHA256:converted",
			}),
		}),
	);
 });

 it("passes a custom output passphrase when re-encrypting imported ppk", async () => {
 parseFromStringMock.mockResolvedValueOnce({
 publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICustomPass user@test",
 privateKey: "[REDACTED PRIVATE KEY]",
 fingerprint: "SHA256:custom-pass",
 });
 vi.mocked(prisma.sshKey.create).mockResolvedValueOnce({
 id: "key_4",
 name: "custom-pass-key",
 fingerprint: "SHA256:custom-pass",
 description: null,
 } as any);

 await createSshKey({
 name: "custom-pass-key",
 ppkContent: "PuTTY-User-Key-File-3: ssh-ed25519\n...",
 ppkPassphrase: "source-secret",
 privateKeyEncryptionMode: "custom",
 privateKeyOutputPassphrase: "target-secret",
 });

 expect(parseFromStringMock).toHaveBeenCalledWith("PuTTY-User-Key-File-3: ssh-ed25519\n...", "source-secret", {
 encrypt: true,
 outputPassphrase: "target-secret",
 });
 });

 it("rejects custom re-encryption without a new output passphrase", async () => {
 await expect(
 createSshKey({
 name: "invalid-key",
 ppkContent: "PuTTY-User-Key-File-3: ssh-ed25519\n...",
 privateKeyEncryptionMode: "custom",
 }),
 ).rejects.toThrow("选择自定义加密格式时，必须填写新的私钥口令。");
 });

 it("creates a server profile bound to an ssh key", async () => {
	vi.mocked(prisma.sshKey.findUnique).mockResolvedValueOnce({
	id: "key_1",
	name: "prod-root-key",
	fingerprint: "SHA256:abc",
	} as any);
	vi.mocked(prisma.server.findFirst).mockResolvedValueOnce(null);

	vi.mocked(prisma.server.create).mockResolvedValueOnce({
 id: "srv_1",
 name: "hk-prod-1",
 host: "203.0.113.10",
 port: 22,
 username: "root",
 description: "primary node",
 tags: ["prod", "hk"],
 enabled: true,
 connectionType: "SSH_KEY",
 sshKeyId: "key_1",
 password: null,
 sshKey: { id: "key_1", name: "prod-root-key", fingerprint: "SHA256:abc" },
 storageNode: null,
 commandTargets: [],
 createdAt: new Date(),
 updatedAt: new Date(),
 } as any);

 vi.mocked(prisma.storageNode.findFirst).mockResolvedValueOnce(null);
 vi.mocked(prisma.storageNode.count).mockResolvedValueOnce(0);
 vi.mocked(prisma.storageNode.create).mockResolvedValueOnce({
 id: "sn_1",
 name: "hk-prod-1 存储",
 driver: "SFTP",
 basePath: "/root",
 isDefault: true,
 host: null,
 port: null,
 username: null,
 serverId: "srv_1",
 createdAt: new Date(),
 updatedAt: new Date(),
 } as any);

 vi.mocked(prisma.server.findUnique).mockResolvedValueOnce({
 id: "srv_1",
 name: "hk-prod-1",
 host: "203.0.113.10",
 port: 22,
 username: "root",
 description: "primary node",
 tags: ["prod", "hk"],
 enabled: true,
 connectionType: "SSH_KEY",
 sshKeyId: "key_1",
 password: null,
 sshKey: { id: "key_1", name: "prod-root-key", fingerprint: "SHA256:abc" },
 storageNode: { id: "sn_1", name: "hk-prod-1 存储", driver: "SFTP", isDefault: true, basePath: "/root" },
 commandTargets: [],
 createdAt: new Date(),
 updatedAt: new Date(),
 } as any);

 const result = await createServerProfile({
 name: " hk-prod-1 ",
 host: " 203.0.113.10 ",
 port: 22,
 username: " root ",
 connectionType: "SSH_KEY",
 sshKeyId: " key_1 ",
 description: " primary node ",
 tags: ["prod", " hk "],
 });

 expect(prisma.server.create).toHaveBeenCalledWith(
 expect.objectContaining({
 data: expect.objectContaining({
 host: "203.0.113.10",
 username: "root",
 sshKeyId: "key_1",
 connectionType: "SSH_KEY",
 password: null,
 }),
 }),
 );
 expect(prisma.storageNode.create).toHaveBeenCalledWith(
 expect.objectContaining({
 data: expect.objectContaining({
 name: "hk-prod-1 存储",
 driver: "SFTP",
 serverId: "srv_1",
 }),
 }),
 );
 expect(result.connectionSummary).toContain("SSH 密钥 prod-root-key");
 });

	it("creates a server profile with password authentication", async () => {
	vi.mocked(prisma.server.findFirst).mockResolvedValueOnce(null);
	vi.mocked(prisma.server.create).mockResolvedValueOnce({
 id: "srv_2",
 name: "pw-server",
 host: "10.0.0.1",
 port: 22,
 username: "admin",
 description: "password node",
 tags: [],
 enabled: true,
 connectionType: "PASSWORD",
 sshKeyId: null,
 password: "secret123",
 sshKey: null,
 storageNode: null,
 commandTargets: [],
 createdAt: new Date(),
 updatedAt: new Date(),
 } as any);

 vi.mocked(prisma.storageNode.findFirst).mockResolvedValueOnce(null);
 vi.mocked(prisma.storageNode.count).mockResolvedValueOnce(0);
 vi.mocked(prisma.storageNode.create).mockResolvedValueOnce({
 id: "sn_2",
 name: "pw-server 存储",
 driver: "SFTP",
 basePath: "/root",
 isDefault: true,
 host: null,
 port: null,
 username: null,
 serverId: "srv_2",
 createdAt: new Date(),
 updatedAt: new Date(),
 } as any);

 vi.mocked(prisma.server.findUnique).mockResolvedValueOnce({
 id: "srv_2",
 name: "pw-server",
 host: "10.0.0.1",
 port: 22,
 username: "admin",
 description: "password node",
 tags: [],
 enabled: true,
 connectionType: "PASSWORD",
 sshKeyId: null,
 password: "secret123",
 sshKey: null,
 storageNode: { id: "sn_2", name: "pw-server 存储", driver: "SFTP", isDefault: true, basePath: "/root" },
 commandTargets: [],
 createdAt: new Date(),
 updatedAt: new Date(),
 } as any);

 const result = await createServerProfile({
 name: "pw-server",
 host: "10.0.0.1",
 port: 22,
 username: "admin",
 connectionType: "PASSWORD",
 password: "secret123",
 description: "password node",
 tags: [],
 });

	expect(prisma.server.create).toHaveBeenCalledWith(
	expect.objectContaining({
	data: expect.objectContaining({
	host: "10.0.0.1",
	username: "admin",
	connectionType: "PASSWORD",
	sshKeyId: null,
	password: expect.stringMatching(/^enc:v1:/),
	}),
	}),
	);
 expect(result.connectionSummary).toContain("使用密码连接");
 });


 it("creates a server with global direct gateway enabled during onboarding", async () => {
	execRemoteCommandMock.mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 });
	vi.mocked(prisma.sshKey.findUnique).mockResolvedValueOnce({ id: "key_1", name: "prod-root-key", fingerprint: "SHA256:abc", privateKey: "plain-key" } as any);
	vi.mocked(prisma.server.findFirst).mockResolvedValueOnce(null);
	vi.mocked(prisma.server.create).mockResolvedValueOnce({
 id: "srv_direct", name: "direct-node", host: "203.0.113.10", port: 22, username: "root", description: null, tags: [], enabled: true,
 connectionType: "SSH_KEY", sshKeyId: "key_1", password: null, publicUrl: null, fileProxyPort: 0,
 sshKey: { id: "key_1", name: "prod-root-key", fingerprint: "SHA256:abc", privateKey: "plain-key" }, storageNode: null, commandTargets: [], createdAt: new Date(), updatedAt: new Date(),
 } as any);
 vi.mocked(prisma.storageNode.findFirst).mockResolvedValueOnce(null);
 vi.mocked(prisma.storageNode.count).mockResolvedValueOnce(0);
 vi.mocked(prisma.storageNode.create).mockResolvedValueOnce({ id: "sn_direct", name: "direct-node 存储", driver: "SFTP", basePath: "/root", isDefault: true, serverId: "srv_direct" } as any);
 vi.mocked(prisma.server.update).mockResolvedValueOnce({} as any);
 vi.mocked(prisma.storageNode.updateMany).mockResolvedValueOnce({ count: 1 } as any);
 vi.mocked(prisma.server.findUnique).mockResolvedValueOnce({ id: "srv_direct", host: "203.0.113.10", port: 22, username: "root", password: null, connectionType: "SSH_KEY", sshKeyId: "key_1", fileProxyPort: 0, publicUrl: null, sshKey: { privateKey: "plain-key" }, storageNode: { basePath: "/root", driver: "SFTP" } } as any);
 vi.mocked(prisma.server.findUnique).mockResolvedValueOnce({
 id: "srv_direct", name: "direct-node", host: "203.0.113.10", port: 22, username: "root", description: null, tags: [], enabled: true,
 connectionType: "SSH_KEY", sshKeyId: "key_1", password: null, publicUrl: "http://203.0.113.10:31888", fileProxyPort: 31888,
 sshKey: { id: "key_1", name: "prod-root-key", fingerprint: "SHA256:abc", privateKey: "plain-key" },
 storageNode: { id: "sn_direct", name: "direct-node 存储", driver: "SFTP", isDefault: true, basePath: "/root", directAccessMode: "AUTO", publicBaseUrl: "http://203.0.113.10:31888" },
 commandTargets: [], createdAt: new Date(), updatedAt: new Date(),
 } as any);

 await createServerProfile({ name: "direct-node", host: "203.0.113.10", port: 22, username: "root", connectionType: "SSH_KEY", sshKeyId: "key_1", tags: [], enableDirectGateway: true });

 expect(execRemoteCommandMock).toHaveBeenCalledWith(expect.objectContaining({ command: expect.stringContaining("vcontrolhub-direct.service") }));
 expect(execRemoteCommandMock).toHaveBeenCalledWith(expect.objectContaining({ command: expect.stringContaining("DIRECT_SECRET=test-direct-secret") }));
 expect(prisma.server.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "srv_direct" }, data: expect.objectContaining({ fileProxyPort: 31888, publicUrl: "http://203.0.113.10:31888" }) }));
 expect(prisma.storageNode.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { serverId: "srv_direct", driver: "SFTP" }, data: expect.objectContaining({ directAccessMode: "AUTO", publicBaseUrl: "http://203.0.113.10:31888" }) }));
 });

 it("switches global direct gateway off by uninstalling the service and returning storage to proxy", async () => {
 execRemoteCommandMock.mockResolvedValueOnce({ stdout: "removed", stderr: "", exitCode: 0 });
 vi.mocked(prisma.server.findUnique).mockResolvedValueOnce({ id: "srv_1", host: "203.0.113.10", port: 22, username: "root", password: null, connectionType: "SSH_KEY", sshKeyId: "key_1", fileProxyPort: 31888, publicUrl: "http://203.0.113.10:31888", sshKey: { privateKey: "plain-key" }, storageNode: { basePath: "/root" } } as any);
 vi.mocked(prisma.server.update).mockResolvedValueOnce({} as any);
 vi.mocked(prisma.storageNode.updateMany).mockResolvedValueOnce({ count: 1 } as any);

 await setServerDirectGatewayEnabled("srv_1", false);

 expect(execRemoteCommandMock).toHaveBeenCalledWith(expect.objectContaining({ command: expect.stringContaining("systemctl disable --now vcontrolhub-direct.service") }));
 expect(prisma.server.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "srv_1" }, data: { fileProxyPort: 0, publicUrl: null } }));
 expect(prisma.storageNode.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { serverId: "srv_1" }, data: expect.objectContaining({ directAccessMode: "PROXY", publicBaseUrl: null }) }));
 });

 it("deletes a server after best-effort gateway cleanup when the host is online", async () => {
 execRemoteCommandMock.mockResolvedValueOnce({ stdout: "removed", stderr: "", exitCode: 0 });
 vi.mocked(prisma.server.findUnique).mockResolvedValueOnce({ id: "srv_1", host: "203.0.113.10", port: 22, username: "root", password: null, connectionType: "SSH_KEY", sshKeyId: "key_1", fileProxyPort: 31888, publicUrl: "http://203.0.113.10:31888", sshKey: { privateKey: "plain-key" }, storageNode: { basePath: "/root" } } as any);
 vi.mocked(prisma.server.findUnique).mockResolvedValueOnce({ id: "srv_1", host: "203.0.113.10", port: 22, username: "root", password: null, connectionType: "SSH_KEY", sshKeyId: "key_1", fileProxyPort: 31888, publicUrl: "http://203.0.113.10:31888", sshKey: { privateKey: "plain-key" }, storageNode: { basePath: "/root" } } as any);
 vi.mocked(prisma.server.update).mockResolvedValueOnce({} as any);
 vi.mocked(prisma.storageNode.updateMany).mockResolvedValueOnce({ count: 1 } as any);
 vi.mocked(prisma.server.delete).mockResolvedValueOnce({} as any);

 await deleteServerProfile("srv_1");

 expect(execRemoteCommandMock).toHaveBeenCalled();
 expect(prisma.server.delete).toHaveBeenCalledWith({ where: { id: "srv_1" } });
 });

 it("still deletes a server when offline gateway cleanup fails", async () => {
 execRemoteCommandMock.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));
 vi.mocked(prisma.server.findUnique).mockResolvedValueOnce({ id: "srv_1", host: "203.0.113.10", port: 22, username: "root", password: null, connectionType: "SSH_KEY", sshKeyId: "key_1", fileProxyPort: 31888, publicUrl: "http://203.0.113.10:31888", sshKey: { privateKey: "plain-key" }, storageNode: { basePath: "/root" } } as any);
 vi.mocked(prisma.server.findUnique).mockResolvedValueOnce({ id: "srv_1", host: "203.0.113.10", port: 22, username: "root", password: null, connectionType: "SSH_KEY", sshKeyId: "key_1", fileProxyPort: 31888, publicUrl: "http://203.0.113.10:31888", sshKey: { privateKey: "plain-key" }, storageNode: { basePath: "/root" } } as any);
 vi.mocked(prisma.server.update).mockResolvedValueOnce({} as any);
 vi.mocked(prisma.storageNode.updateMany).mockResolvedValueOnce({ count: 1 } as any);
 vi.mocked(prisma.server.delete).mockResolvedValueOnce({} as any);

 await expect(deleteServerProfile("srv_1")).resolves.toEqual({ deleted: true, cleanupSkipped: true });
 expect(prisma.server.delete).toHaveBeenCalledWith({ where: { id: "srv_1" } });
 });

 it("does not mark direct gateway enabled when best-effort install fails", async () => {
	execRemoteCommandMock.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));
	vi.mocked(prisma.sshKey.findUnique).mockResolvedValueOnce({ id: "key_1", name: "prod-root-key", fingerprint: "SHA256:abc", privateKey: "plain-key" } as any);
	vi.mocked(prisma.server.findFirst).mockResolvedValueOnce(null);
	vi.mocked(prisma.server.create).mockResolvedValueOnce({
 id: "srv_direct_fail", name: "direct-fail", host: "203.0.113.10", port: 22, username: "root", description: null, tags: [], enabled: true,
 connectionType: "SSH_KEY", sshKeyId: "key_1", password: null, publicUrl: null, fileProxyPort: 0,
 sshKey: { id: "key_1", name: "prod-root-key", fingerprint: "SHA256:abc", privateKey: "plain-key" }, storageNode: null, commandTargets: [], createdAt: new Date(), updatedAt: new Date(),
 } as any);
 vi.mocked(prisma.storageNode.findFirst).mockResolvedValueOnce(null);
 vi.mocked(prisma.storageNode.count).mockResolvedValueOnce(0);
 vi.mocked(prisma.storageNode.create).mockResolvedValueOnce({ id: "sn_direct_fail", name: "direct-fail 存储", driver: "SFTP", basePath: "/root", isDefault: true, serverId: "srv_direct_fail" } as any);
 vi.mocked(prisma.server.findUnique).mockResolvedValueOnce({ id: "srv_direct_fail", host: "203.0.113.10", port: 22, username: "root", password: null, connectionType: "SSH_KEY", sshKeyId: "key_1", fileProxyPort: 0, publicUrl: null, sshKey: { privateKey: "plain-key" }, storageNode: { basePath: "/root", driver: "SFTP" } } as any);
 vi.mocked(prisma.server.findUnique).mockResolvedValueOnce({
 id: "srv_direct_fail", name: "direct-fail", host: "203.0.113.10", port: 22, username: "root", description: null, tags: [], enabled: true,
 connectionType: "SSH_KEY", sshKeyId: "key_1", password: null, publicUrl: null, fileProxyPort: 0,
 sshKey: { id: "key_1", name: "prod-root-key", fingerprint: "SHA256:abc", privateKey: "plain-key" },
 storageNode: { id: "sn_direct_fail", name: "direct-fail 存储", driver: "SFTP", isDefault: true, basePath: "/root", directAccessMode: "PROXY", publicBaseUrl: null },
 commandTargets: [], createdAt: new Date(), updatedAt: new Date(),
 } as any);

 await createServerProfile({ name: "direct-fail", host: "203.0.113.10", port: 22, username: "root", connectionType: "SSH_KEY", sshKeyId: "key_1", tags: [], enableDirectGateway: true });
 expect(prisma.server.update).not.toHaveBeenCalled();
 expect(prisma.storageNode.updateMany).not.toHaveBeenCalled();
 });

	it("rejects duplicate enabled server endpoints before creating storage nodes", async () => {
	vi.mocked(prisma.server.findFirst).mockResolvedValueOnce({
	id: "srv_existing",
	name: "existing-node",
	host: "203.0.113.10",
	port: 22,
	username: "root",
	} as any);

	await expect(createServerProfile({
	name: "duplicate-node",
	host: "203.0.113.10",
	port: 22,
	username: "root",
	connectionType: "PASSWORD",
	password: "secret123",
	tags: [],
	})).rejects.toThrow("已存在相同主机、端口和用户名的");

	expect(prisma.server.create).not.toHaveBeenCalled();
	expect(prisma.storageNode.create).not.toHaveBeenCalled();
	});

	it("lists onboarded servers with ssh-key summaries", async () => {
 vi.mocked(prisma.server.findMany).mockResolvedValueOnce([
 {
 id: "srv_1",
 name: "hk-prod-1",
 host: "203.0.113.10",
 port: 22,
 username: "root",
 description: null,
 tags: ["prod"],
 enabled: true,
 connectionType: "SSH_KEY",
 sshKeyId: "key_1",
 password: null,
 sshKey: { id: "key_1", name: "prod-root-key", fingerprint: "SHA256:abc" },
 storageNode: null,
 commandTargets: [],
 createdAt: new Date(),
 updatedAt: new Date(),
 } as any,
 ]);

 const result = await listServerProfiles();

 expect(result).toHaveLength(1);
 expect(result[0]?.connectionSummary).toContain("prod-root-key");
 });

 it("lists onboarded servers with password summaries", async () => {
 vi.mocked(prisma.server.findMany).mockResolvedValueOnce([
 {
 id: "srv_2",
 name: "pw-server",
 host: "10.0.0.1",
 port: 22,
 username: "admin",
 description: null,
 tags: [],
 enabled: true,
 connectionType: "PASSWORD",
 sshKeyId: null,
 password: "secret123",
 sshKey: null,
 storageNode: null,
 commandTargets: [],
 createdAt: new Date(),
 updatedAt: new Date(),
 } as any,
 ]);

 const result = await listServerProfiles();

 expect(result).toHaveLength(1);
 expect(result[0]?.connectionSummary).toContain("使用密码连接");
 });
});
