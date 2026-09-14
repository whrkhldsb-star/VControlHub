import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";

// The throttling fixture must intercept requests before the PWA service worker.
test.use({ serviceWorkers: "block" });

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
  await page
    .locator("[data-file-browser]")
    .getByRole("button", { name: /上传文件|Upload files/i })
    .click();
  const uploadDialog = page.getByRole("dialog", { name: /上传到|Upload to/i });
  await uploadDialog
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name,
      mimeType: "application/octet-stream",
      buffer: bytes,
    });
  await expect.poll(() => limited).toBeGreaterThan(0);
  await uploadDialog.getByRole("button", { name: /暂停|Pause/i }).click();
  await expect(uploadDialog).toContainText(/已暂停|Paused/i);
  await uploadDialog.getByRole("button", { name: /关闭|Close/i }).click();
  await page.getByRole("button", { name: /总览与监控|Overview.*Monitoring/i }).click();
  await page.locator('a[href="/dashboard"]:visible').first().click({ timeout: 10000 });
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole("button", { name: /上传任务|Uploads/i }).click();
  const queue = page.getByRole("dialog", { name: /上传任务|Uploads/i });
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
  await queue.getByRole("button", { name: /继续|恢复|Resume/i }).click();
  await expect(queue).toContainText(/完成|Done/i, { timeout: 90000 });
  const downloaded = await context.request.get(
    `/api/storage/local?nodeId=node_local_default&path=${name}`,
  );
  expect(downloaded.status()).toBe(200);
  expect(await downloaded.body()).toEqual(bytes);
  await queue.getByRole("button", { name: /关闭|Close/i }).click();
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
  await sourceRow
    .getByRole("button", { name: /收藏与标签|Favorite and tags/i })
    .click();
  const preferences = page.getByRole("dialog", {
    name: /收藏与标签|Favorite and tags/i,
  });
  await preferences.getByRole("checkbox", { name: /收藏|Favorite/i }).check();
  await preferences.getByRole("textbox").fill("qa, durable");
  await preferences.getByRole("button", { name: /保存|Save/i }).click();
  await expect(preferences).toBeHidden();
  await page.getByRole("button", { name: /我的文件|My files/i }).click();
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
  await sourceRow.getByRole("button", { name: /^复制$|^Copy$/i }).click();
  const copyDialog = page.getByRole("dialog", { name: /^复制$|^Copy$/i });
  await copyDialog.getByRole("button", { name: /选择目标文件夹|Choose destination folder/i }).click();
  const picker = page.getByRole("dialog", { name: /选择目标文件夹|Choose destination folder/i });
  await expect(picker.getByRole("button", { name: /选择此文件夹|Use this folder/i })).toBeEnabled();
  await picker.getByRole("button", { name: /取消|Cancel/i }).click();
  await expect(copyDialog).toBeVisible();
  await copyDialog.getByRole("textbox").fill(directory);
  await copyDialog.getByRole("combobox").selectOption("overwrite");
  await expect(copyDialog).toContainText(/覆盖|Overwrite/i);
  await copyDialog.getByRole("combobox").selectOption("rename");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await copyDialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("copy-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 720 });
  const queuedResponse = page.waitForResponse((response) => response.url().endsWith("/api/files/operations") && response.request().method() === "POST");
  await copyDialog.getByRole("button", { name: /^确认$|^Confirm$/i }).click();
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
  await page.getByRole("button", { name: /文件任务|File tasks/i }).click();
  const tasks = page.getByRole("dialog", { name: /文件任务|File tasks/i });
  await expect(tasks).toContainText(/已完成|Completed/);
  await page.screenshot({
    path: testInfo.outputPath("file-tasks-desktop.png"),
  });
  await tasks.getByRole("button", { name: /关闭|Close/i }).click();
  await page.getByRole("button", { name: /新建文件夹|New folder/i }).click();
  await page.getByLabel(/文件夹名称|Folder name/i).fill("moved");
  await page.getByRole("button", { name: /^创建$|^Create$/i }).click();
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
