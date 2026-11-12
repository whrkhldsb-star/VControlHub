import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";

// The throttling fixture must intercept requests before the PWA service worker.
test.use({ serviceWorkers: "block" });

/** A row's actions live in its "more" menu. */
async function openMore(page: Page, name: string) {
  const pattern = name.replace(/[.()]/g, "\\$&");
  await page.getByRole("button", { name: new RegExp(`^(?:更多操作|More actions) ${pattern}$`) }).first().click();
  const menu = page.getByRole("menu", { name: new RegExp(`(?:更多操作|More actions) ${pattern}`) });
  await expect(menu).toBeVisible();
  return menu;
}

test("upload queue pauses, survives route navigation, resumes and preserves uploaded bytes", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180000);
  await installDirectSession(context);
  await page.goto("/files?nodeId=node_local_default");
  const name = `qa-queue-${Date.now()}.bin`;
  const bytes = Buffer.alloc(6 * 1024 * 1024, 73);
  let limited = 0;
  let allowChunks = false;
  await page.route("**/api/images/upload/*/chunk?*", async (route) => {
    if (!allowChunks) {
      limited++;
      await route.fulfill({
        status: 429,
        headers: { "Retry-After": "2" },
        json: { error: "temporary throttle" },
      });
    } else await route.continue();
  });
  // Upload is a menu of the drive's toolbar; the queue is a region above the page, on every page.
  await page
    .locator("[data-file-browser]")
    .getByRole("button", { name: /^(?:上传|Upload)$/i })
    .click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /^(?:上传文件|Upload files)$/i }).click();
  await (await chooser).setFiles({
    name,
    mimeType: "application/octet-stream",
    buffer: bytes,
  });
  await expect.poll(() => limited).toBeGreaterThan(0);
  const queue = page.getByRole("region", { name: /上传任务|Uploads/i });
  await queue.getByRole("button", { name: /^(?:暂停|Pause)$/i }).click();
  await expect(queue).toContainText(/已暂停|Paused/i);
  const dashboardLink = page.locator('a[href="/dashboard"]:visible').first();
  if (await dashboardLink.count() === 0) await page.getByRole("button", { name: /^(总览|Overview)$/i }).click();
  await page.locator('a[href="/dashboard"]:visible').first().click({ timeout: 10000 });
  await expect(page).toHaveURL(/\/dashboard/);
  // The paused upload came along to the other page.
  await expect(queue).toContainText(name);
  await expect(queue).toContainText(/已暂停|Paused/i);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await queue.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("upload-queue-mobile.png"),
  });
  allowChunks = true;
  await queue.getByRole("button", { name: /继续上传|Resume upload/i }).click();
  await expect(queue).toContainText(/已上传 1 个文件|Uploaded 1 files/i, { timeout: 90000 });
  const downloaded = await context.request.get(
    `/api/storage/local?nodeId=node_local_default&path=${name}`,
  );
  expect(downloaded.status()).toBe(200);
  expect(await downloaded.body()).toEqual(bytes);
  await page.screenshot({
    path: testInfo.outputPath("upload-status-mobile.png"),
  });
});

test("file preferences and durable copy/move/delete preserve bytes and survive navigation", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(240000);
  await installDirectSession(context);
  await page.goto("/files?nodeId=node_local_default");
  const csrf = (await context.cookies()).find(
    (cookie) => cookie.name === "csrf_token",
  )?.value;
  expect(csrf).toBeTruthy();
  const headers = { "x-csrf-token": csrf! };
  const directory = `qa-enhanced-${Date.now()}`;
  const upload = await context.request.post("/api/storage/local", {
    headers,
    multipart: {
      storageNodeId: "node_local_default",
      relativePath: `${directory}/source.txt`,
      file: {
        name: "source.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("durable copy proof"),
      },
    },
  });
  expect(upload.ok(), await upload.text()).toBe(true);
  await page.goto(`/files?nodeId=node_local_default&path=${directory}`);
  const sourceRow = page
    .locator("[data-file-entry-id]")
    .filter({
      has: page.getByRole("link", { name: "source.txt", exact: true }),
    })
    .first();
  await expect(sourceRow).toBeVisible();
  const sourceId = await sourceRow.getAttribute("data-file-entry-id");
  expect(sourceId).toBeTruthy();
  await (await openMore(page, "source.txt")).getByRole("menuitem", { name: /编辑标签…|Edit tags…/i }).click();
  const preferences = page.getByRole("dialog", {
    name: /收藏与标签|Favorite and tags/i,
  });
  await preferences.getByRole("checkbox", { name: /收藏|Favorite/i }).check();
  await preferences.getByRole("textbox").fill("qa, durable");
  await preferences.getByRole("button", { name: /保存|Save/i }).click();
  await expect(preferences).toBeHidden();
  // "My files" opens from quick access; a favourite is listed with its tags.
  const quickAccess = page.getByRole("navigation", { name: /快速访问|Quick access/i });
  await quickAccess.getByRole("button", { name: /^(?:收藏|Favorites)$/i }).click();
  const collection = page.getByRole("dialog", { name: /我的文件|My files/i });
  await expect(collection).toContainText("source.txt");
  await expect(collection).toContainText("durable");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await collection.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("collections-mobile.png"),
  });
  await collection.getByRole("button", { name: /关闭|Close/i }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  const waitJob = async (id: string) => {
    let result: { status: string; errorMessage?: string } | undefined;
    await expect
      .poll(
        async () => {
          const response = await context.request.get("/api/files/operations");
          const data = await response.json();
          result = data.jobs.find((job: { id: string }) => job.id === id);
          return !!result && !["PENDING", "RUNNING"].includes(result.status);
        },
        { timeout: 90000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);
    expect(result?.status, result?.errorMessage).toBe("COMPLETED");
  };
  // "Copy to…" opens a folder browser on the folder the file is in; a copy next to its source is renamed.
  await (await openMore(page, "source.txt")).getByRole("menuitem", { name: /复制到…|Copy to…/i }).click();
  const copyDialog = page.getByRole("dialog", { name: /^(?:复制到|Copy to)$/i });
  const copyHere = copyDialog.getByRole("button", { name: /复制到此处|Copy here/i });
  await expect(copyHere).toBeEnabled({ timeout: 20000 });
  await expect(copyDialog.getByRole("navigation", { name: /面包屑|Breadcrumb/i })).toContainText(directory);
  await copyDialog.getByRole("combobox").selectOption("overwrite");
  await expect(copyDialog).toContainText(/同名文件将被替换|replaced/i);
  await copyDialog.getByRole("combobox").selectOption("rename");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await copyDialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("copy-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 720 });
  const queuedResponse = page.waitForResponse((response) => response.url().endsWith("/api/files/operations") && response.request().method() === "POST");
  await copyHere.click();
  const queued = await queuedResponse;
  const copyInput = queued.request().postDataJSON();
  expect(queued.status(), await queued.text()).toBe(202);
  const job = await queued.json();
  await page.goto("/dashboard");
  await waitJob(job.id);
  const duplicate = await context.request.post("/api/files/operations", {
    headers,
    data: copyInput,
  });
  expect(duplicate.status(), await duplicate.text()).toBe(202);
  expect((await duplicate.json()).id).toBe(job.id);
  const copied = await context.request.get(
    `/api/storage/local?nodeId=node_local_default&path=${encodeURIComponent(`${directory}/source (1).txt`)}`,
  );
  expect(copied.status()).toBe(200);
  expect(await copied.text()).toBe("durable copy proof");
  await page.goto(`/files?nodeId=node_local_default&path=${directory}`);
  await page.getByRole("navigation", { name: /快速访问|Quick access/i }).getByRole("button", { name: /文件任务|File tasks/i }).click();
  const tasks = page.getByRole("dialog", { name: /文件任务|File tasks/i });
  await expect(tasks).toContainText(/已完成|Completed/);
  await page.screenshot({
    path: testInfo.outputPath("file-tasks-desktop.png"),
  });
  await tasks.getByRole("button", { name: /关闭|Close/i }).click();
  await page.locator("[data-file-browser]").getByRole("button", { name: /新建文件夹|New folder/i }).click();
  const newFolder = page.getByRole("dialog", { name: /新建文件夹|New folder/i });
  await newFolder.getByLabel(/文件夹名称|Folder name/i).fill("moved");
  await newFolder.getByRole("button", { name: /^创建$|^Create$/i }).click();
  await expect(newFolder).toBeHidden({ timeout: 15000 });
  const destination = page.locator(`[data-file-drop-path="${directory}/moved"]:visible`).first();
  await expect(destination).toBeVisible();
  await sourceRow.getByRole("link", { name: "source.txt", exact: true }).dragTo(destination);
  const moveDialog = page.getByRole("dialog", { name: /^移动$|^Move$/i });
  await expect(moveDialog).toContainText(`${directory}/moved`);
  const moveResponse = page.waitForResponse((response) => response.url().endsWith("/api/files/operations") && response.request().method() === "POST");
  await moveDialog.getByRole("button", { name: /^确认$|^Confirm$/i }).click();
  const moved = await moveResponse;
  expect(moved.status(), await moved.text()).toBe(202);
  await waitJob((await moved.json()).id);
  const saved = await context.request.get(
    `/api/files/preferences?mode=entry&fileEntryId=${sourceId}`,
  );
  expect((await saved.json()).items[0]).toMatchObject({
    favorite: true,
    tags: ["qa", "durable"],
    fileEntry: { relativePath: `${directory}/moved/source.txt` },
  });
  const deleted = await context.request.post("/api/files/operations", {
    headers,
    data: {
      requestId: randomUUID(),
      action: "delete",
      fileEntryIds: [sourceId],
    },
  });
  expect(deleted.status(), await deleted.text()).toBe(202);
  await waitJob((await deleted.json()).id);
  const hidden = await context.request.get(
    `/api/files/preferences?mode=entry&fileEntryId=${sourceId}`,
  );
  expect((await hidden.json()).items).toEqual([]);
});
