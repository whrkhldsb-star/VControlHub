import { readFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Client } from "ssh2";
import { loginWithCredentials } from "./helpers/login";

const enabled = process.env.E2E_LIVE_ACCEPTANCE === "1";
const user = process.env.E2E_USER ?? "admin";
const password = process.env.E2E_PASS ?? "";
const liveHost = process.env.E2E_LIVE_SERVER_HOST ?? "";
const livePort = process.env.E2E_LIVE_SERVER_PORT ?? "22";
const liveUser = process.env.E2E_LIVE_SERVER_USER ?? "root";
const livePassword = process.env.E2E_LIVE_SERVER_PASS ?? "";
const liveName =
  process.env.E2E_LIVE_SERVER_NAME ?? "VControlHub live acceptance";

async function execLiveSsh(command: string) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>(
    (resolve, reject) => {
      const client = new Client();
      let settled = false;
      const finish = (
        result: { stdout: string; stderr: string; exitCode: number } | Error,
      ) => {
        if (settled) return;
        settled = true;
        client.end();
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      client
        .once("ready", () => {
          client.exec(command, (error, stream) => {
            if (error) {
              finish(error);
              return;
            }
            let stdout = "";
            let stderr = "";
            stream.on("data", (chunk: Buffer) => {
              stdout += chunk.toString("utf8");
            });
            stream.stderr.on("data", (chunk: Buffer) => {
              stderr += chunk.toString("utf8");
            });
            stream.once("close", (code: number | null) => {
              finish({ stdout, stderr, exitCode: code ?? 255 });
            });
          });
        })
        .once("error", finish)
        .connect({
          host: liveHost,
          port: Number(livePort),
          username: liveUser,
          password: livePassword,
          readyTimeout: 30_000,
        });
    },
  );
}

test.describe("live production acceptance", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    !enabled,
    "Set E2E_LIVE_ACCEPTANCE=1 to run against explicitly authorized live resources.",
  );
  test.skip(!password, "Live login credentials are required.");

  async function login(page: Page) {
    await loginWithCredentials(page, user, password);
  }

  async function openServerCard(page: Page) {
    await page.goto("/servers");
    const card = page
      .locator("[data-server-card]", { hasText: liveHost })
      .first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    return card;
  }

  test("registers or reuses the authorized VPS and exercises SSH, diagnostics, and SFTP", async ({
    page,
  }, testInfo: TestInfo) => {
    test.skip(
      !liveHost || !livePassword,
      "Live server credentials are required for the VPS acceptance flow.",
    );
    test.setTimeout(300_000);
    const terminalSocketEvents: string[] = [];
    page.on("websocket", (socket) => {
      if (!new URL(socket.url()).pathname.endsWith("/ssh")) return;
      terminalSocketEvents.push("opened");
      socket.on("framereceived", ({ payload }) => {
        const value = typeof payload === "string" ? payload : payload.toString("utf8");
        try {
          const message = JSON.parse(value) as { type?: string; data?: string };
          terminalSocketEvents.push(
            message.type === "output" ? "output" : `${message.type ?? "unknown"}:${message.data ?? ""}`,
          );
        } catch {
          terminalSocketEvents.push("non-json-frame");
        }
      });
      socket.on("socketerror", (error) => terminalSocketEvents.push(`socket-error:${error}`));
      socket.on("close", () => terminalSocketEvents.push("closed"));
    });
    await login(page);
    await page.goto("/servers");

    const existingCard = page
      .locator("[data-server-card]", { hasText: liveHost })
      .first();
    const existingCardReady = await existingCard
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (!existingCardReady) {
      const addTab = page.getByRole("tab", { name: /添加 VPS|Add VPS/i });
      if (await addTab.isVisible().catch(() => false)) await addTab.click();
      const form = page.locator("form", { has: page.locator("#serverName") });
      await form.locator("#serverName").fill(liveName);
      await form
        .locator("#serverDesc")
        .fill("Browser acceptance target; safe read-only and /tmp checks only");
      await form.locator("#serverHost").fill(liveHost);
      await form.locator("#serverPort").fill(livePort);
      await form.getByRole("button", { name: /密码|Password/i }).click();
      await form.locator("#serverUsername").fill(liveUser);
      await form.locator("#serverPassword").fill(livePassword);
      await form.locator("#serverTags").fill("acceptance,live");
      await form
        .getByRole("button", {
          name: /检测连接并获取指纹|Check connection and get fingerprint/i,
        })
        .click();
      const trust = form.locator('input[type="checkbox"][required]');
      await expect(trust).toBeVisible({ timeout: 30_000 });
      await trust.check();
      await form
        .getByRole("button", {
          name: /确认.*(?:保存|添加)|Confirm.*(?:save|add)/i,
        })
        .click();
      await expect(form.getByRole("status")).toBeVisible({ timeout: 45_000 });
    }

    let card = await openServerCard(page);
    await card.getByRole("button", { name: /查看详情|View details/i }).click();
    const details = page.locator("[data-server-details-modal]");
    await expect(details).toBeVisible();

    const osResponse = page.waitForResponse(
      (response) =>
        /\/api\/servers\/[^/]+\/detect-os$/.test(
          new URL(response.url()).pathname,
        ) && response.request().method() === "POST",
    );
    await details.getByRole("button", { name: /探测 OS|Detect OS/i }).click();
    expect((await osResponse).status()).toBe(200);
    await expect(details).not.toContainText(/探测失败|Detection failed/i);

    const monitorResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/servers/monitor" &&
        response.request().method() === "GET",
    );
    await details
      .getByRole("button", { name: /运行实时探测|Run realtime diagnostics/i })
      .click();
    expect((await monitorResponse).status()).toBe(200);
    await expect(
      details.locator('[role="status"][data-tone="emerald"]'),
    ).toContainText(/成功|succeeded/i, { timeout: 30_000 });
    await details
      .getByRole("button", { name: /收起详情|Close details/i })
      .first()
      .click();

    card = await openServerCard(page);
    await card.getByRole("button", { name: /SSH 终端|SSH terminal/i }).click();
    const terminal = page.locator('[data-ssh-terminal-dialog="true"]');
    await expect(terminal).toBeVisible();
    await expect(terminal.getByRole("status").first()).toContainText(
      /已连接|Connected/i,
      { timeout: 45_000 },
    ).catch((error) => {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nSSH WebSocket events: ${terminalSocketEvents.join(" | ") || "none"}`,
      );
    });

    const marker = `VCONTROLHUB_TERMINAL_${Date.now()}`;
    const command = `printf '${marker}\\n'`;
    await terminal
      .getByRole("button", { name: /命令面板|Command panel/i })
      .click();
    await terminal
      .getByRole("textbox", {
        name: /添加常用 SSH 命令|Add favorite SSH command/i,
      })
      .fill(command);
    await terminal
      .getByRole("button", { name: /添加常用命令|Add favorite command/i })
      .click();
    await terminal.getByTitle(command).click();
    await expect(terminal.locator(".xterm-rows")).toContainText(marker, {
      timeout: 20_000,
    });
    await terminal
      .getByRole("button", {
        name: new RegExp(`(?:删除常用命令|Remove favorite command).*${marker}`),
      })
      .click();

    await terminal
      .getByRole("button", { name: /^(?:文件(?:管理)?|Files)$/i })
      .click({ timeout: 10_000 });
    const fileManager = terminal
      .locator('[data-testid^="ssh-file-manager-"]:visible')
      .first();
    await expect(fileManager).toBeVisible();
    await expect(
      fileManager.getByRole("button", { name: /上传|Upload/i }),
    ).toBeEnabled({ timeout: 30_000 });
    await expect(fileManager).not.toContainText(
      /读取目录失败|Failed to list|Invalid input/i,
    );
    const fileEntry = (name: string) =>
      fileManager.locator(`[data-ssh-file-entry="${name}"]:visible`);

    const staleArtifacts = (
      await fileManager
        .locator("[data-ssh-file-entry]:visible")
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute("data-ssh-file-entry") ?? ""),
        )
    ).filter((name) => /^vcontrolhub-live-\d+(?:-renamed)?\.txt$/.test(name));
    for (const staleName of staleArtifacts) {
      const staleRow = fileEntry(staleName);
      await staleRow.hover();
      await staleRow.getByRole("button", { name: /删除|Delete/i }).click();
      const staleDeleteDialog = page.getByRole("dialog", {
        name: /确认删除|Confirm delete/i,
      });
      await staleDeleteDialog
        .getByRole("button", { name: /确认删除|Confirm delete/i })
        .click();
      await expect(fileEntry(staleName)).toBeHidden({ timeout: 30_000 });
    }

    const fileName = `vcontrolhub-live-${Date.now()}.txt`;
    const renamed = fileName.replace(".txt", "-renamed.txt");
    await fileManager.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from(`${marker}\n`, "utf8"),
    });
    await expect(fileEntry(fileName)).toBeVisible({ timeout: 30_000 });
    await page.screenshot({
      path: testInfo.outputPath("live-sftp-file-manager.png"),
    });
    const fileRow = fileEntry(fileName);
    await fileRow.hover();
    await fileRow
      .getByRole("button", { name: /重命名|Rename/i })
      .click({ timeout: 10_000 });
    await fileManager
      .getByRole("textbox", { name: /重命名|Rename/i })
      .fill(renamed);
    await fileManager
      .getByRole("button", { name: /^确认$|^Confirm$/i })
      .click();
    await expect(fileEntry(renamed)).toBeVisible({ timeout: 30_000 });
    const renamedRow = fileEntry(renamed);
    await renamedRow.hover();
    await renamedRow
      .getByRole("button", { name: /删除|Delete/i })
      .click({ timeout: 10_000 });
    const deleteDialog = page.getByRole("dialog", {
      name: /确认删除|Confirm delete/i,
    });
    await deleteDialog
      .getByRole("button", { name: /确认删除|Confirm delete/i })
      .click();
    await expect(fileEntry(renamed)).toBeHidden({ timeout: 30_000 });
  });

  test("exercises the main SFTP file browser through a complete managed lifecycle", async ({
    page,
    context,
  }, testInfo: TestInfo) => {
    test.skip(
      !liveHost || !livePassword,
      "Live server credentials are required for the managed SFTP flow.",
    );
    test.setTimeout(600_000);
    page.setDefaultTimeout(45_000);
    page.setDefaultNavigationTimeout(60_000);
    await login(page);
    await page.goto("/files");

    const nodeSelect = page.getByLabel(/选择存储节点|Select storage node/i);
    await expect(nodeSelect).toBeVisible({ timeout: 30_000 });
    const nodeId = await nodeSelect.locator("option").evaluateAll(
      (options, expectedName) =>
        options.find((option) =>
          (option.textContent ?? "").includes(String(expectedName)),
        )?.getAttribute("value") ?? "",
      liveName,
    );
    expect(nodeId).not.toBe("");
    const selectNodeResponse = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/files/list" &&
          url.searchParams.get("nodeId") === nodeId
        );
      },
    );
    await nodeSelect.selectOption(nodeId);
    expect((await selectNodeResponse).status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`nodeId=${nodeId}`), {
      timeout: 30_000,
    });

    const stamp = Date.now();
    const marker = `VCONTROLHUB_MANAGED_SFTP_${stamp}`;
    const updatedMarker = `${marker}_UPDATED`;
    const folder = `vcontrolhub-managed-${stamp}`;
    const nestedFolder = "moved";
    const textName = `notes-${stamp}.txt`;
    const renamedText = `notes-${stamp}-renamed.txt`;
    const markdownName = `readme-${stamp}.md`;
    const csvName = `inventory-${stamp}.csv`;
    const imageName = `pixel-${stamp}.png`;
    const managedPath = (path = "") =>
      `/files?nodeId=${encodeURIComponent(nodeId)}${
        path ? `&path=${encodeURIComponent(path)}` : ""
      }`;
    const browserArticle = () =>
      page
        .getByRole("heading", {
          name: /当前目录操作|Current directory actions/i,
        })
        .locator("xpath=ancestor::article[1]");
    const rowFor = (name: string) =>
      browserArticle()
        .getByText(name, { exact: true })
        .first()
        .locator("xpath=ancestor::div[contains(@class,'grid-cols')][1]");

    await expect(browserArticle()).toBeVisible({ timeout: 30_000 });
    await expect(browserArticle()).toContainText(liveName);
    await browserArticle()
      .getByRole("button", { name: /新建文件夹|New folder/i })
      .click();
    await browserArticle()
      .getByLabel(/文件夹名称|Folder name/i)
      .fill(folder);
    await browserArticle()
      .getByRole("button", { name: /^创建$|^Create$/i })
      .click();
    const rootFolderButton = browserArticle().getByRole("button", {
      name: folder,
      exact: true,
    });
    await expect(rootFolderButton).toBeVisible({ timeout: 30_000 });
    await rootFolderButton.click();
    await expect(page).toHaveURL(new RegExp(`path=${folder}`), {
      timeout: 30_000,
    });

    await browserArticle()
      .getByRole("button", { name: /新建文件夹|New folder/i })
      .click();
    await browserArticle()
      .getByLabel(/文件夹名称|Folder name/i)
      .fill(nestedFolder);
    await browserArticle()
      .getByRole("button", { name: /^创建$|^Create$/i })
      .click();
    await expect(
      browserArticle().getByRole("button", {
        name: nestedFolder,
        exact: true,
      }),
    ).toBeVisible({ timeout: 30_000 });

    await browserArticle()
      .getByRole("button", { name: /上传文件|Upload files/i })
      .click();
    const uploadDialog = page.getByRole("dialog", {
      name: /上传到|Upload to/i,
    });
    await uploadDialog.locator('input[type="file"]').first().setInputFiles([
      {
        name: textName,
        mimeType: "text/plain",
        buffer: Buffer.from(`${marker}\noriginal\n`, "utf8"),
      },
      {
        name: markdownName,
        mimeType: "text/markdown",
        buffer: Buffer.from(`# ${marker}\n\nManaged markdown preview.\n`, "utf8"),
      },
      {
        name: csvName,
        mimeType: "text/csv",
        buffer: Buffer.from(`name,value\n${marker},42\n`, "utf8"),
      },
      {
        name: imageName,
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0ssAAAAASUVORK5CYII=",
          "base64",
        ),
      },
    ]);
    for (const name of [textName, markdownName, csvName, imageName]) {
      await expect(browserArticle().getByText(name, { exact: true }).first()).toBeVisible({
        timeout: 45_000,
      });
    }
    await uploadDialog.getByRole("button", { name: /关闭|Close/i }).click();

    await browserArticle().getByRole("link", { name: textName, exact: true }).first().click();
    await expect(page).toHaveURL(/\/files\/preview/);
    await expect(page.locator("main")).toContainText(marker, { timeout: 30_000 });
    await page.getByRole("button", { name: /^编辑$|^Edit$/i }).click();
    const editor = page.getByRole("textbox", {
      name: /在线编辑文件内容|Edit file content/i,
    });
    await editor.fill(`${updatedMarker}\nchanged through browser\n`);
    await page
      .getByRole("button", { name: /预览并保存|Preview.*save/i })
      .click();
    const diffDialog = page.getByRole("dialog", {
      name: /保存前差异(?:预览|确认)|Review changes before saving/i,
    });
    await expect(diffDialog).toContainText(updatedMarker);
    await diffDialog
      .getByRole("button", { name: /确认保存|Confirm save/i })
      .click();
    await expect(page.getByRole("status")).toContainText(/已保存|Saved/i, {
      timeout: 30_000,
    });
    await page.reload();
    await expect(page.locator("main")).toContainText(updatedMarker, {
      timeout: 30_000,
    });
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: /^下载$|^Download$/i }).click();
    const downloaded = await downloadPromise;
    const downloadedPath = await downloaded.path();
    expect(downloadedPath).not.toBeNull();
    expect(await readFile(downloadedPath!, "utf8")).toContain(updatedMarker);
    await page.screenshot({
      path: testInfo.outputPath("live-managed-text-preview.png"),
      fullPage: true,
    });

    await page.goto(managedPath(folder));
    await browserArticle().getByRole("link", { name: markdownName, exact: true }).first().click();
    await expect(page.getByRole("heading", { name: marker })).toBeVisible({
      timeout: 30_000,
    });
    await page.goto(managedPath(folder));
    await browserArticle().getByRole("link", { name: csvName, exact: true }).first().click();
    await expect(page.getByRole("cell", { name: marker })).toBeVisible({
      timeout: 30_000,
    });
    await page.goto(managedPath(folder));
    await browserArticle().getByRole("link", { name: imageName, exact: true }).first().click();
    await expect(page.getByRole("img", { name: imageName })).toBeVisible({
      timeout: 30_000,
    });

    await page.goto(managedPath(folder));
    const textRow = rowFor(textName);
    await textRow
      .getByRole("button", { name: new RegExp(`(?:更多操作|More actions) ${textName}`) })
      .click();
    let moreMenu = page.getByRole("group", {
      name: new RegExp(`(?:更多操作|More actions) ${textName}`),
    });
    await moreMenu.getByRole("button", { name: new RegExp(`(?:重命名|Rename) ${textName}`) }).click();
    await moreMenu.getByRole("textbox", { name: /新名称|New name/i }).fill(renamedText);
    await moreMenu.getByRole("button", { name: /^确认$|^Confirm$/i }).click();
    await expect(browserArticle().getByRole("link", { name: renamedText, exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(moreMenu).toBeHidden({ timeout: 30_000 });

    const renamedRow = rowFor(renamedText);
    await renamedRow
      .getByRole("button", { name: new RegExp(`(?:更多操作|More actions) ${renamedText}`) })
      .click();
    moreMenu = page.getByRole("group", {
      name: new RegExp(`(?:更多操作|More actions) ${renamedText}`),
    });
    const shareResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/share-links" &&
        response.request().method() === "POST",
    );
    await moreMenu.getByRole("button", { name: /^分享$|^Share$/i }).click();
    const shareResponse = await shareResponsePromise;
    expect(shareResponse.status()).toBe(201);
    const { token } = (await shareResponse.json()) as { token: string };
    const publicPage = await context.newPage();
    await publicPage.goto(`/share/${token}`);
    await expect(publicPage.locator("main")).toContainText(renamedText);
    const publicDownloadPromise = publicPage.waitForEvent("download");
    await publicPage
      .getByRole("link", { name: /下载文件|Download file/i })
      .click();
    const publicDownload = await publicDownloadPromise;
    const publicDownloadPath = await publicDownload.path();
    expect(publicDownloadPath).not.toBeNull();
    expect(await readFile(publicDownloadPath!, "utf8")).toContain(updatedMarker);
    await publicPage.close();

    await page.goto(managedPath(folder));
    const search = page.getByRole("textbox", { name: /搜索文件名|Search file name/i });
    await search.fill(renamedText);
    await search.press("Enter");
    await expect(browserArticle().getByRole("link", { name: renamedText, exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /内容|Content/i }).first().click();
    const contentSearch = page.getByRole("textbox", { name: /^内容$|^Content$/i });
    await contentSearch.fill(updatedMarker);
    await contentSearch.press("Enter");
    await expect(page.getByText(updatedMarker, { exact: false }).last()).toBeVisible({
      timeout: 45_000,
    });

    await page.goto(managedPath(folder));
    const moveRow = rowFor(renamedText);
    await moveRow
      .getByRole("button", { name: new RegExp(`(?:更多操作|More actions) ${renamedText}`) })
      .click();
    moreMenu = page.getByRole("group", {
      name: new RegExp(`(?:更多操作|More actions) ${renamedText}`),
    });
    await moreMenu.getByRole("button", { name: new RegExp(`(?:移动|Move) ${renamedText}`) }).click();
    await moreMenu
      .getByRole("textbox", { name: /目标路径|Target path/i })
      .fill(`${folder}/${nestedFolder}`);
    await moreMenu.getByRole("button", { name: /^确认$|^Confirm$/i }).click();
    await expect(browserArticle().getByRole("link", { name: renamedText, exact: true })).toHaveCount(0, {
      timeout: 30_000,
    });

    const movedSharePage = await context.newPage();
    await movedSharePage.goto(`/share/${token}`);
    await expect(movedSharePage.locator("main")).toContainText(renamedText);
    const movedShareDownloadPromise = movedSharePage.waitForEvent("download");
    await movedSharePage
      .getByRole("link", { name: /下载文件|Download file/i })
      .click();
    const movedShareDownload = await movedShareDownloadPromise;
    const movedShareDownloadPath = await movedShareDownload.path();
    expect(movedShareDownloadPath).not.toBeNull();
    expect(await readFile(movedShareDownloadPath!, "utf8")).toContain(updatedMarker);
    await movedSharePage.close();

    for (const name of [markdownName, csvName, imageName]) {
      await browserArticle().getByLabel(new RegExp(`(?:选择|Select) ${name}`)).first().check();
    }
    await page.getByRole("button", { name: /批量移动|Batch move/i }).click();
    await page
      .getByRole("textbox", { name: /批量移动目标路径|Batch move target path/i })
      .fill(`${folder}/${nestedFolder}`);
    await page.getByRole("button", { name: /确认移动|Confirm move/i }).click();
    for (const name of [markdownName, csvName, imageName]) {
      await expect(browserArticle().getByText(name, { exact: true })).toHaveCount(0, {
        timeout: 45_000,
      });
    }

    await page.goto(managedPath(`${folder}/${nestedFolder}`));
    for (const name of [renamedText, markdownName, csvName, imageName]) {
      await expect(browserArticle().getByText(name, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
    }
    await page.goto(managedPath(folder));
    const archivePromise = page.waitForEvent("download");
    await rowFor(nestedFolder)
      .getByRole("link", { name: /下载目录归档|Download folder archive/i })
      .click();
    const archive = await archivePromise;
    expect(archive.suggestedFilename()).toMatch(/\.tar\.gz$/);
    const archivePath = await archive.path();
    expect(archivePath).not.toBeNull();
    expect((await readFile(archivePath!)).byteLength).toBeGreaterThan(0);

    await page.goto(managedPath(`${folder}/${nestedFolder}`));
    for (const name of [markdownName, csvName, imageName]) {
      await browserArticle().getByLabel(new RegExp(`(?:选择|Select) ${name}`)).first().check();
    }
    await page.getByRole("button", { name: /批量删除|Batch delete/i }).click();
    await page.getByRole("button", { name: /确认删除|Confirm delete/i }).click();
    for (const name of [markdownName, csvName, imageName]) {
      await expect(browserArticle().getByText(name, { exact: true })).toHaveCount(0, {
        timeout: 45_000,
      });
    }

    const deleteManagedEntry = async (name: string) => {
      const row = rowFor(name);
      await row
        .getByRole("button", { name: new RegExp(`(?:更多操作|More actions) ${name}`) })
        .click();
      const menu = page.getByRole("group", {
        name: new RegExp(`(?:更多操作|More actions) ${name}`),
      });
      await menu.getByRole("button", { name: new RegExp(`(?:删除|Delete) ${name}`) }).click();
      await menu.getByRole("button", { name: /^确认$|^Confirm$/i }).click();
      await expect(browserArticle().getByText(name, { exact: true })).toHaveCount(0, {
        timeout: 30_000,
      });
    };
    await deleteManagedEntry(renamedText);

    await page.goto("/files/recycle-bin");
    const recycleRow = (name: string) =>
      page
        .getByText(name, { exact: true })
        .first()
        .locator("xpath=ancestor::div[contains(@class,'grid')][1]");
    await recycleRow(renamedText)
      .getByRole("button", { name: /^恢复$|^Restore$/i })
      .click();
    await expect(page.getByText(renamedText, { exact: true })).toHaveCount(0, {
      timeout: 30_000,
    });
    await page.goto(managedPath(`${folder}/${nestedFolder}`));
    await expect(browserArticle().getByRole("link", { name: renamedText, exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await deleteManagedEntry(renamedText);

    await page.goto("/files/recycle-bin");
    for (const name of [renamedText, markdownName, csvName, imageName]) {
      const row = recycleRow(name);
      await row
        .getByRole("button", { name: /永久删除|Delete permanently/i })
        .click();
      await row.getByRole("button", { name: /^确认$|^Confirm$/i }).click();
      await expect(page.getByText(name, { exact: true })).toHaveCount(0, {
        timeout: 30_000,
      });
    }

    const deleteFolderPermanently = async (path: string, name: string) => {
      await page.goto(managedPath(path));
      const folderRow = rowFor(name);
      await folderRow
        .getByRole("button", { name: new RegExp(`(?:删除|Delete) ${name}`) })
        .click();
      await folderRow.getByRole("button", { name: /^确认$|^Confirm$/i }).click();
      await expect(browserArticle().getByText(name, { exact: true })).toHaveCount(0, {
        timeout: 30_000,
      });
      await page.goto("/files/recycle-bin");
      const row = recycleRow(name);
      await row
        .getByRole("button", { name: /永久删除|Delete permanently/i })
        .click();
      await row.getByRole("button", { name: /^确认$|^Confirm$/i }).click();
      await expect(page.getByText(name, { exact: true })).toHaveCount(0, {
        timeout: 30_000,
      });
    };
    await deleteFolderPermanently(folder, nestedFolder);
    await deleteFolderPermanently("", folder);
  });

  test("executes and rolls back a safe deployment, then runs a one-time task", async ({
    page,
  }) => {
    test.skip(
      !liveHost || !livePassword,
      "Live server credentials are required for the execution acceptance flow.",
    );
    test.setTimeout(600_000);
    page.setDefaultTimeout(45_000);
    page.setDefaultNavigationTimeout(60_000);

    const stamp = Date.now();
    const templateName = `vcontrolhub-acceptance-template-${stamp}`;
    const scheduledName = `vcontrolhub-acceptance-once-${stamp}`;
    const deployMarker = `/tmp/vcontrolhub-acceptance-deploy-${stamp}`;
    const scheduledMarker = `/tmp/vcontrolhub-acceptance-once-${stamp}`;
    const deployCommand = `printf '%s\\n' '${stamp}' > '${deployMarker}'`;
    const rollbackCommand = `rm -f -- '${deployMarker}'`;
    const scheduledCommand = `printf '%s\\n' '${stamp}' > '${scheduledMarker}'`;
    const markerState = async (path: string) => {
      const result = await execLiveSsh(
        `if [ -f '${path}' ]; then printf 'present:'; cat '${path}'; else printf 'absent'; fi`,
      );
      return result.stdout.trim();
    };
    const commandArticle = (title: string) =>
      page.locator("article").filter({
        has: page.getByRole("heading", { name: title, exact: true }),
      });
    const approveCommand = async (title: string) => {
      await page.goto("/requests");
      const article = commandArticle(title);
      await expect(article).toBeVisible({ timeout: 45_000 });
      await article
        .getByRole("button", { name: /批准执行|Approve & execute/i })
        .click();
      await expect(
        article.getByRole("button", { name: /批准执行|Approve & execute/i }),
      ).toHaveCount(0, { timeout: 30_000 });
    };

    await execLiveSsh(`rm -f -- '${deployMarker}' '${scheduledMarker}'`);
    await login(page);

    try {
      await page.goto("/templates");
      await page
        .getByRole("button", { name: /创建模板|Create template/i })
        .first()
        .click();
      await page
        .getByLabel(/模板名称|Template name/i)
        .fill(templateName);
      await page
        .getByLabel(/^命令内容$|^Command$/i)
        .fill(deployCommand);
      await page
        .getByLabel(/回滚命令|Rollback command/i)
        .fill(rollbackCommand);
      await page
        .getByLabel(/标签|Tags/i)
        .fill("acceptance,safe-execution");
      const createTemplateResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/command-templates" &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: /^创建模板$|^Create template$/i })
        .last()
        .click();
      expect((await createTemplateResponse).status()).toBeLessThan(300);

      const templateCard = page.locator("article").filter({
        has: page.getByRole("heading", { name: templateName, exact: true }),
      });
      await expect(templateCard).toBeVisible({ timeout: 30_000 });
      await templateCard
        .getByRole("button", { name: /一键下发|Deploy/i })
        .click();
      const liveTarget = templateCard.locator("label", { hasText: liveName });
      await expect(liveTarget).toBeVisible();
      await liveTarget.getByRole("checkbox").check();
      const deploymentResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/deployments" &&
          response.request().method() === "POST",
      );
      await templateCard
        .getByRole("button", { name: /提交部署|Submit deployment/i })
        .click();
      expect((await deploymentResponse).status()).toBe(201);

      await approveCommand(`Deployment: ${templateName}`);
      await expect
        .poll(() => markerState(deployMarker), {
          timeout: 120_000,
          intervals: [2_000, 4_000, 8_000],
        })
        .toBe(`present:${stamp}`);

      await page.goto("/deployments");
      const rollback = page
        .getByRole("button", { name: /执行真实回滚|Execute real rollback/i })
        .filter({ visible: true })
        .first();
      await expect(rollback).toBeEnabled({ timeout: 45_000 });
      await rollback.click();
      const rollbackResponse = page.waitForResponse(
        (response) =>
          /\/api\/deployments\/[^/]+\/rollback$/.test(
            new URL(response.url()).pathname,
          ) && response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: /确认回滚|Confirm rollback/i })
        .first()
        .click();
      expect((await rollbackResponse).status()).toBe(201);

      await approveCommand(`Rollback deployment: ${templateName}`);
      await expect
        .poll(() => markerState(deployMarker), {
          timeout: 120_000,
          intervals: [2_000, 4_000, 8_000],
        })
        .toBe("absent");

      await page.goto("/scheduled-tasks");
      await page
        .getByRole("button", { name: /创建定时任务|Create scheduled task/i })
        .click();
      await page
        .getByRole("button", { name: /单次执行|Run once/i })
        .click();
      await page.getByLabel(/任务名称|Task name/i).fill(scheduledName);
      const runAt = new Date(Date.now() + 75_000).toISOString().slice(0, 16);
      await page.getByLabel(/执行时间|Run at/i).fill(runAt);
      await page
        .getByLabel(/^命令内容$|^Command$/i)
        .fill(scheduledCommand);
      await page
        .getByLabel(/每次运行前需要审批|Require approval before every run/i)
        .uncheck();
      const targetNodes = page.getByRole("group", {
        name: /目标节点|Target servers/i,
      });
      const scheduledTarget = targetNodes.locator("label", {
        hasText: liveName,
      });
      await expect(scheduledTarget).toBeVisible();
      await scheduledTarget.getByRole("checkbox").check();
      const createScheduledResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/scheduled-tasks" &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: /^创建任务$|^Create task$/i })
        .click();
      expect((await createScheduledResponse).status()).toBe(200);
      await expect(page.getByText(scheduledName, { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await expect
        .poll(() => markerState(scheduledMarker), {
          timeout: 210_000,
          intervals: [5_000, 10_000, 15_000],
        })
        .toBe(`present:${stamp}`);
      await page.reload();
      const scheduledCard = page.locator("article", {
        has: page.getByRole("heading", { name: scheduledName, exact: true }),
      });
      await expect(scheduledCard).toContainText(/已执行[:：]?\s*1\s*次|Runs?[:：]?\s*1/i, {
        timeout: 45_000,
      });
      await scheduledCard
        .getByRole("button", { name: /删除|Delete/i })
        .click();
      await page
        .getByRole("dialog", {
          name: /确认删除定时任务|Delete scheduled task/i,
        })
        .getByRole("button", { name: /确认删除|Confirm delete/i })
        .click();
      await expect(page.getByText(scheduledName, { exact: true })).toHaveCount(0, {
        timeout: 30_000,
      });

      await page.goto("/templates");
      const cleanupTemplateCard = page.locator("article").filter({
        has: page.getByRole("heading", { name: templateName, exact: true }),
      });
      await cleanupTemplateCard
        .getByRole("button", { name: /^删除$|^Delete$/i })
        .click();
      await page
        .getByRole("dialog", { name: /删除命令模板|Delete command template/i })
        .getByRole("button", { name: /确认删除|Confirm delete/i })
        .click();
      await expect(page.getByText(templateName, { exact: true })).toHaveCount(0, {
        timeout: 30_000,
      });
    } finally {
      await execLiveSsh(`rm -f -- '${deployMarker}' '${scheduledMarker}'`);
    }
  });

  test("runs a safe playbook against the live VPS and records its history", async ({
    page,
  }) => {
    test.skip(
      !liveHost || !livePassword,
      "Live server credentials are required for the playbook acceptance flow.",
    );
    test.setTimeout(240_000);
    const stamp = Date.now();
    const name = `vcontrolhub-acceptance-playbook-${stamp}`;
    const marker = `VCONTROLHUB_PLAYBOOK_${stamp}`;
    const markerPath = `/tmp/vcontrolhub-playbook-${stamp}`;
    await login(page);
    await execLiveSsh(`rm -f -- '${markerPath}'`);

    try {
      await page.goto("/playbooks");
      await page
        .getByRole("button", { name: /新建 Playbook|New Playbook/i })
        .first()
        .click();
      await page.getByLabel(/Playbook 名称|Playbook Name/i).fill(name);
      await page.getByLabel(/步骤名称|Step name/i).fill("write safe marker");
      await page
        .getByRole("textbox", { name: /命令|Command/i })
        .fill(`printf '${marker}\\n' > '${markerPath}'`);
      const targets = page.getByRole("group", {
        name: /目标 VPS|Target VPS/i,
      });
      const target = targets.locator("label", { hasText: liveName });
      await expect(target).toBeVisible();
      await target.getByRole("checkbox").check();
      const createResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/playbooks" &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: /保存 Playbook|Save Playbook/i })
        .click();
      expect((await createResponse).status()).toBeLessThan(300);

      const card = page.locator("article").filter({
        has: page.getByRole("heading", { name, exact: true }),
      });
      await expect(card).toBeVisible({ timeout: 30_000 });
      const runResponse = page.waitForResponse(
        (response) =>
          /\/api\/playbooks\/[^/]+\/run$/.test(
            new URL(response.url()).pathname,
          ) && response.request().method() === "POST",
      );
      await card
        .getByRole("button", { name: /立即运行|Run now/i })
        .click();
      expect((await runResponse).status()).toBeLessThan(300);
      await expect
        .poll(
          async () => {
            const result = await execLiveSsh(`cat -- '${markerPath}'`);
            return result.exitCode === 0 ? result.stdout.trim() : "";
          },
          { timeout: 120_000, intervals: [2_000, 4_000, 8_000] },
        )
        .toBe(marker);
      await expect
        .poll(
          async () => {
            await page.reload();
            const refreshed = page.locator("article").filter({
              has: page.getByRole("heading", { name, exact: true }),
            });
            await refreshed.locator("summary").click();
            return refreshed.innerText();
          },
          { timeout: 45_000, intervals: [1_000, 2_000, 4_000] },
        )
        .toMatch(/已完成|Completed/i);
      const refreshed = page.locator("article").filter({
        has: page.getByRole("heading", { name, exact: true }),
      });
      await refreshed.getByRole("button", { name: /删除|Delete/i }).click();
      await page
        .getByRole("dialog", { name: /删除 Playbook|Delete Playbook/i })
        .getByRole("button", { name: /确认删除|Confirm Delete/i })
        .click();
      await expect(page.getByText(name, { exact: true })).toHaveCount(0, {
        timeout: 30_000,
      });
    } finally {
      await execLiveSsh(`rm -f -- '${markerPath}'`);
    }
  });

  test("creates a real database backup and completes a non-destructive drill", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const note = `vcontrolhub-acceptance-backup-${Date.now()}`;
    await login(page);
    await page.goto("/backups");
    await page.locator("#create-backup-type").selectOption("DATABASE");
    await page.locator("#create-backup-note").fill(note);
    await page
      .getByRole("button", { name: /创建并执行|Create and execute/i })
      .click();
    await expect(page.getByText(note, { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await expect
      .poll(
        async () => {
          await page.reload();
          return page
            .locator("[data-list-row]", { hasText: note })
            .first()
            .getByRole("button", {
              name: /执行无损恢复演练|Run non-destructive restore drill/i,
            })
            .isEnabled();
        },
        { timeout: 180_000, intervals: [2_000, 4_000, 8_000] },
      )
      .toBe(true);

    const row = page.locator("[data-list-row]", { hasText: note }).first();
    const drillResponse = page.waitForResponse(
      (response) =>
        /\/api\/backups\/[^/]+\/drill$/.test(
          new URL(response.url()).pathname,
        ) && response.request().method() === "POST",
    );
    await row
      .getByRole("button", {
        name: /执行无损恢复演练|Run non-destructive restore drill/i,
      })
      .click();
    const response = await drillResponse;
    expect(response.status()).toBeLessThan(300);
    const drillPayload = (await response.json()) as { taskId: string };
    await expect(row.getByText(drillPayload.taskId, { exact: false })).toBeVisible();
    await row
      .getByRole("link", { name: /查看任务报告|View task report/i })
      .click();
    await expect(page).toHaveURL(/\/operation-tasks/);
    await expect
      .poll(
        async () => {
          await page.reload();
          return page
            .locator("[data-list-row]", { hasText: "backup.drill" })
            .first()
            .innerText();
        },
        { timeout: 120_000, intervals: [2_000, 4_000, 8_000] },
      )
      .toMatch(/已完成|Completed/i);
  });

  test("installs and manages a remote quick service through its full lifecycle", async ({
    page,
  }) => {
    test.skip(
      !liveHost || !livePassword,
      "Live server credentials are required for the quick-service acceptance flow.",
    );
    test.setTimeout(600_000);
    await execLiveSsh("docker rm -f qs-dufs >/dev/null 2>&1 || true");
    await login(page);

    const containerState = async () => {
      const result = await execLiveSsh(
        "docker inspect --format='{{.State.Status}}' qs-dufs 2>/dev/null || printf absent",
      );
      return result.stdout.trim();
    };
    const selectRemoteTarget = async () => {
      const targetSelect = page.getByRole("combobox", {
        name: /部署节点|Target node/i,
      });
      await expect(targetSelect.locator("option")).toHaveCount(2, {
        timeout: 30_000,
      });
      const remoteOption = targetSelect.locator("option", { hasText: liveHost });
      const remoteValue = await remoteOption.getAttribute("value");
      expect(remoteValue).toBeTruthy();
      await targetSelect.selectOption(remoteValue!);
      await expect(page.getByText(liveName, { exact: true })).toBeVisible();
    };

    try {
      await page.goto("/quick-services");
      await selectRemoteTarget();
      const search = page.locator("#quick-service-search");
      await search.fill("Dufs");
      const card = page.locator("[data-card]", {
        has: page.getByRole("heading", {
          name: "Dufs File Sharing",
          exact: true,
        }),
      }).last();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card
        .getByRole("button", { name: /一键安装|Install/i })
        .click();
      const portDialog = page.getByRole("dialog", {
        name: /安装 Dufs File Sharing|Install Dufs File Sharing/i,
      });
      const advance = portDialog.getByRole("button", {
        name: /确认安装|Confirm install/i,
      });
      await expect(advance).toBeEnabled({ timeout: 30_000 });
      await advance.click();
      const configDialog = page.getByRole("dialog", {
        name: /确认安装配置|Confirm install configuration/i,
      });
      const installResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/quick-services" &&
          response.request().method() === "POST",
      );
      await configDialog
        .getByRole("button", { name: /确认安装|Confirm install/i })
        .click();
      expect((await installResponse).status()).toBeLessThan(300);
      await expect
        .poll(containerState, {
          timeout: 300_000,
          intervals: [5_000, 10_000, 15_000],
        })
        .toBe("running");

      await page.reload();
      await selectRemoteTarget();
      await page
        .getByRole("tab", { name: /已安装|Installed/i })
        .click();
      await page.locator("#quick-service-search").fill("Dufs");
      const installedCard = page.locator("[data-card]", {
        has: page.getByRole("heading", {
          name: "Dufs File Sharing",
          exact: true,
        }),
      }).last();
      await expect(installedCard).toContainText(/运行中|Running/i, {
        timeout: 30_000,
      });
      await expect(
        installedCard.getByRole("link", { name: /访问 Dufs|Open Dufs/i }),
      ).toHaveAttribute("href", new RegExp(`^http://${liveHost}:5001/dufs/`));

      await installedCard
        .getByRole("button", { name: /停止|Stop/i })
        .click();
      await expect
        .poll(containerState, { timeout: 90_000, intervals: [2_000, 4_000] })
        .toBe("exited");
      await expect(
        installedCard.getByRole("button", { name: /启动|Start/i }),
      ).toBeVisible({ timeout: 30_000 });
      await installedCard
        .getByRole("button", { name: /启动|Start/i })
        .click();
      await expect
        .poll(containerState, { timeout: 90_000, intervals: [2_000, 4_000] })
        .toBe("running");

      const containerIdBeforeUpdate = (
        await execLiveSsh("docker inspect --format='{{.Id}}' qs-dufs")
      ).stdout.trim();
      await installedCard
        .getByRole("button", { name: /更新|Update/i })
        .click();
      const updateDialog = page.getByRole("dialog", {
        name: /确认更新配置|Confirm update configuration/i,
      });
      const updateResponse = page.waitForResponse(
        (response) =>
          /\/api\/quick-services\/dufs$/.test(
            new URL(response.url()).pathname,
          ) && response.request().method() === "PATCH",
      );
      await updateDialog
        .getByRole("button", { name: /确认更新|Confirm update/i })
        .click();
      expect((await updateResponse).status()).toBeLessThan(300);
      await expect
        .poll(async () => {
          const result = await execLiveSsh(
            "docker inspect --format='{{.State.Status}}:{{.Id}}' qs-dufs 2>/dev/null || printf absent",
          );
          return result.stdout.trim();
        }, {
          timeout: 300_000,
          intervals: [5_000, 10_000, 15_000],
        })
        .toMatch(new RegExp(`^running:(?!${containerIdBeforeUpdate}$).+`));

      await page.goto("/operation-tasks?type=quick_service.lifecycle");
      await expect
        .poll(
          async () => {
            await page.reload();
            return page
              .locator("[data-list-row]", {
                hasText: "quick_service.lifecycle",
              })
              .first()
              .innerText();
          },
          { timeout: 120_000, intervals: [2_000, 4_000, 8_000] },
        )
        .toMatch(/已完成|Completed/i);
      await page.goto("/quick-services");
      await selectRemoteTarget();
      await page
        .getByRole("tab", { name: /已安装|Installed/i })
        .click();
      await page.locator("#quick-service-search").fill("Dufs");
      await expect(installedCard).toContainText(/运行中|Running/i, {
        timeout: 30_000,
      });

      await installedCard
        .getByRole("button", { name: /卸载|Uninstall/i })
        .click();
      const uninstallResponse = page.waitForResponse(
        (response) =>
          /\/api\/quick-services\/dufs$/.test(
            new URL(response.url()).pathname,
          ) && response.request().method() === "DELETE",
      );
      await page
        .getByRole("dialog", {
          name: /确认卸载快捷服务|Confirm uninstall/i,
        })
        .getByRole("button", { name: /确认卸载|Confirm uninstall/i })
        .click();
      expect((await uninstallResponse).status()).toBeLessThan(300);
      await expect
        .poll(containerState, {
          timeout: 120_000,
          intervals: [2_000, 4_000, 8_000],
        })
        .toBe("absent");
    } finally {
      await execLiveSsh("docker rm -f qs-dufs >/dev/null 2>&1 || true");
    }
  });

  test("uses the configured AI provider for a real streamed response", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await login(page);
    await page.goto("/ai");
    const newConversation = page
      .getByRole("button", { name: /^\+\s*(?:新对话|New chat)$/i })
      .last();
    await expect(newConversation).toBeVisible();
    await newConversation.click();
    const input = page.getByRole("textbox", {
      name: /消息输入|Message input/i,
    });
    await expect(input).toBeVisible({ timeout: 30_000 });
    const marker = `VCONTROLHUB_AI_${Date.now()}`;
    await input.fill(
      `这是一次系统验收。不要调用工具，不要执行命令，只回复这一段文本：${marker}`,
    );
    await page.getByRole("button", { name: /发送消息|Send message/i }).click();
    await expect(page.getByText(marker, { exact: false }).last()).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.locator("body")).not.toContainText(
      /API Key.*未配置|provider.*unavailable|请求失败|Request failed/i,
    );
    const activeTitle = (
      await page.locator("[data-ai-workspace] h3").first().textContent()
    )?.trim();
    if (activeTitle) {
      await page
        .getByRole("button", {
          name: new RegExp(
            `(?:删除对话|Delete conversation) ${activeTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
          ),
        })
        .first()
        .click();
      await page
        .getByRole("dialog", { name: /删除对话|Delete conversation/i })
        .getByRole("button", { name: /确认删除|Confirm delete/i })
        .click();
    }
  });

  test("uses AI-hosted tools and completes the two-stage command approval", async ({
    page,
  }) => {
    test.skip(
      !liveHost || !livePassword,
      "Live server credentials are required for the AI-hosted acceptance flow.",
    );
    test.setTimeout(300_000);
    await login(page);
    await page.goto("/ai");
    const createConversationResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/ai/conversations" &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: /^\+\s*(?:新对话|New chat)$/i })
      .last()
      .click();
    const conversationResponse = await createConversationResponse;
    const createdConversation = (await conversationResponse.json()) as {
      conversation: { id: string };
    };

    const input = page.getByRole("textbox", {
      name: /消息输入|Message input/i,
    });
    await expect(input).toBeVisible({ timeout: 30_000 });
    await page
      .getByRole("button", { name: /^(?:设置|Settings)$/i })
      .click();
    const hostedToggle = page.locator("label", {
      hasText: /AI托管模式|AI-hosted mode/i,
    }).locator('input[type="checkbox"]');
    await expect(hostedToggle).toBeVisible();
    if (!(await hostedToggle.isChecked())) await hostedToggle.check();
    await page
      .getByRole("button", { name: /协助执行|Assisted execution/i })
      .click();
    const saveSettingsResponse = page.waitForResponse(
      (response) =>
        /\/api\/ai\/conversations\/[^/]+$/.test(
          new URL(response.url()).pathname,
        ) && response.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: /保存设置|Save settings/i })
      .click();
    expect((await saveSettingsResponse).status()).toBe(200);
    await page
      .getByRole("button", { name: /^(?:设置|Settings)$/i })
      .click();

    await input.fill(
      "这是系统验收。请必须调用 list_servers 工具查询可操作的服务器，不要凭空回答；工具完成后用一句话告诉我数量。",
    );
    await page.getByRole("button", { name: /发送消息|Send message/i }).click();
    await expect(page.getByText("list_servers", { exact: true }).last()).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByText(/托管操作|Hosted activity/i).last()).toBeVisible();

    const stamp = Date.now();
    const marker = `VCONTROLHUB_AI_HOSTED_${stamp}`;
    const markerPath = `/tmp/vcontrolhub-ai-hosted-${stamp}`;
    try {
      await input.fill(
        `这是受控验收。请必须调用 execute_command 工具，在 IP 为 ${liveHost} 的服务器执行命令 printf '${marker}\\n' > '${markerPath}'，原因为“验证 AI 托管审批链路”。不要只给出命令文本。`,
      );
      await page.getByRole("button", { name: /发送消息|Send message/i }).click();
      await expect(page.getByText("execute_command", { exact: true }).last()).toBeVisible({
        timeout: 120_000,
      });
      const confirmHosted = page
        .getByRole("button", {
          name: /^(?:确认创建请求|Confirm request)$/i,
        })
        .last();
      await expect(confirmHosted).toBeVisible({ timeout: 30_000 });
      const hostedResponse = page.waitForResponse(
        (response) =>
          /\/api\/ai\/hosted-actions\/[^/]+$/.test(
            new URL(response.url()).pathname,
          ) && response.request().method() === "PATCH",
      );
      await confirmHosted.click();
      expect((await hostedResponse).status()).toBe(200);

      await page.goto("/requests");
      const requestCard = page.locator("article[data-card]", {
        hasText: marker,
      }).first();
      await expect(requestCard).toBeVisible({ timeout: 30_000 });
      await requestCard
        .getByRole("textbox", { name: /审批意见|Review comment/i })
        .fill("Live AI-hosted acceptance");
      await requestCard
        .getByRole("button", {
          name: /批准执行|Approve (?:&|and) execute/i,
        })
        .click();
      await expect
        .poll(
          async () => {
            const result = await execLiveSsh(`cat -- '${markerPath}'`);
            return result.exitCode === 0 ? result.stdout.trim() : "";
          },
          { timeout: 90_000, intervals: [2_000, 4_000, 8_000] },
        )
        .toBe(marker);
      await expect
        .poll(
          async () => {
            await page.reload();
            return page
              .locator("article[data-card]", { hasText: marker })
              .first()
              .innerText();
          },
          { timeout: 45_000, intervals: [1_000, 2_000, 4_000] },
        )
        .toMatch(/已完成|Completed/i);
    } finally {
      await execLiveSsh(`rm -f -- '${markerPath}'`);
      const cleanupStatus = await page.evaluate(async (conversationId) => {
        const token = document.cookie
          .split("; ")
          .find((part) => part.startsWith("csrf_token="))
          ?.slice("csrf_token=".length);
        const response = await fetch(`/api/ai/conversations/${conversationId}`, {
          method: "DELETE",
          headers: token
            ? { "X-CSRF-Token": decodeURIComponent(token) }
            : undefined,
        });
        return response.status;
      }, createdConversation.conversation.id);
      expect(cleanupStatus).toBe(200);
    }
  });

  test("keeps AI plan-only mode non-mutating while producing an executable plan", async ({
    page,
  }) => {
    test.skip(
      !liveHost || !livePassword,
      "Live server credentials are required for the plan-only acceptance flow.",
    );
    test.setTimeout(180_000);
    await login(page);
    await page.goto("/ai");
    const createConversationResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/ai/conversations" &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: /^\+\s*(?:新对话|New chat)$/i })
      .last()
      .click();
    const createdConversation = (await (
      await createConversationResponse
    ).json()) as { conversation: { id: string } };
    const stamp = Date.now();
    const marker = `VCONTROLHUB_PLAN_ONLY_${stamp}`;
    const markerPath = `/tmp/vcontrolhub-plan-only-${stamp}`;

    try {
      await page
        .getByRole("button", { name: /^(?:设置|Settings)$/i })
        .click();
      const hostedToggle = page.locator("label", {
        hasText: /AI托管模式|AI-hosted mode/i,
      }).locator('input[type="checkbox"]');
      if (!(await hostedToggle.isChecked())) await hostedToggle.check();
      await page
        .getByRole("button", { name: /仅生成方案|Plan only/i })
        .click();
      const saveResponse = page.waitForResponse(
        (response) =>
          /\/api\/ai\/conversations\/[^/]+$/.test(
            new URL(response.url()).pathname,
          ) && response.request().method() === "PATCH",
      );
      await page
        .getByRole("button", { name: /保存设置|Save settings/i })
        .click();
      expect((await saveResponse).status()).toBe(200);
      await page
        .getByRole("button", { name: /^(?:设置|Settings)$/i })
        .click();

      const input = page.getByRole("textbox", {
        name: /消息输入|Message input/i,
      });
      await input.fill(
        `请为 IP ${liveHost} 设计一个单次任务方案：执行 printf '${marker}\\n' > '${markerPath}'。只给方案，绝不能执行或保存任务；方案必须包含命令、验证、回滚、执行时间和审批策略，并原样包含 ${marker}。`,
      );
      const chatResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/ai/chat" &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: /发送消息|Send message/i }).click();
      expect((await chatResponse).status()).toBe(200);
      await expect
        .poll(
          () => page.getByText(marker, { exact: false }).count(),
          { timeout: 120_000, intervals: [1_000, 2_000, 4_000] },
        )
        .toBeGreaterThanOrEqual(2);
      await expect(
        page.getByRole("button", {
          name: /确认创建请求|确认执行|Confirm request|Confirm action/i,
        }),
      ).toHaveCount(0);
      const verification = await execLiveSsh(
        `if [ -e '${markerPath}' ]; then printf present; else printf absent; fi`,
      );
      expect(verification.stdout.trim()).toBe("absent");
    } finally {
      await execLiveSsh(`rm -f -- '${markerPath}'`);
      const cleanupStatus = await page.evaluate(async (conversationId) => {
        const token = document.cookie
          .split("; ")
          .find((part) => part.startsWith("csrf_token="))
          ?.slice("csrf_token=".length);
        return (
          await fetch(`/api/ai/conversations/${conversationId}`, {
            method: "DELETE",
            headers: token
              ? { "X-CSRF-Token": decodeURIComponent(token) }
              : undefined,
          })
        ).status;
      }, createdConversation.conversation.id);
      expect(cleanupStatus).toBe(200);
    }
  });

  test("binds AI Ops to the configured provider and completes a manual scan", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await login(page);
    await page.goto("/ai-ops");
    const settings = page.locator('section[aria-label="ai-ops-settings"]');
    const provider = settings.locator("select").nth(1);
    await expect(provider.locator("option")).toHaveCount(2, {
      timeout: 20_000,
    });
    if (!(await provider.inputValue()))
      await provider.selectOption({ index: 1 });
    const saveResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/ai/ops/settings" &&
        response.request().method() === "PATCH",
    );
    await settings.getByRole("button", { name: /保存|Save/i }).click();
    expect((await saveResponse).status()).toBe(200);

    const scanResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/ai/ops/scan" &&
        response.request().method() === "POST",
    );
    await page
      .locator('section[aria-label="ai-ops-actions"]')
      .getByRole("button", { name: /立即扫描|Scan now|Trigger scan/i })
      .click({ timeout: 10_000 });
    expect((await scanResponse).status()).toBeLessThan(300);

    await expect
      .poll(
        async () => {
          await page
            .locator('section[aria-label="ai-ops-actions"]')
            .getByRole("button", { name: /刷新|Refresh/i })
            .click();
          return page
            .locator('section[aria-label="ai-ops-logs"] tbody tr')
            .first()
            .textContent();
        },
        { timeout: 120_000, intervals: [2_000, 4_000, 8_000] },
      )
      .toMatch(/正常|警告|错误|OK|Warning|Error/i);
  });

  test("captures representative desktop and mobile surfaces without clipping", async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(120_000);
    await login(page);
    const routes = [
      "/dashboard",
      "/servers",
      "/files",
      "/ai",
      "/ai-ops",
      "/operation-tasks",
      "/scheduled-tasks",
      "/requests",
      "/monitoring",
      "/settings",
    ];
    const browserFailures: string[] = [];
    page.on("pageerror", (error) => browserFailures.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 500)
        browserFailures.push(`${response.status()} ${response.url()}`);
    });

    for (const route of routes) {
      await page.goto(route);
      await expect(
        page.locator("main, [data-ai-workspace]").first(),
      ).toBeVisible();
      if (route === "/monitoring") {
        await expect(
          page.getByText(/^(?:加载中[.…]*|Loading[.…]*)$/i),
        ).toBeHidden({ timeout: 30_000 });
        await expect(
          page.getByRole("heading", { name: /服务器监控|Host Monitoring/i }),
        ).toBeVisible();
      }
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(
          `desktop-${route.slice(1).replaceAll("/", "-")}.png`,
        ),
        fullPage: route !== "/ai",
      });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of [
      "/dashboard",
      "/servers",
      "/files",
      "/ai",
      "/ai-ops",
    ]) {
      await page.goto(route);
      await expect(
        page.locator("main, [data-ai-workspace]").first(),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`mobile-${route.slice(1)}.png`),
        fullPage: route !== "/ai",
      });
    }
    expect(browserFailures).toEqual([]);
  });
});
