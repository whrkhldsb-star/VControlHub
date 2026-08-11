import { readFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
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
    );

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
