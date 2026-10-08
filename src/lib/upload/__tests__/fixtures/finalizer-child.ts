import { writeFile } from "node:fs/promises";
import { beginUploadFinalization } from "../../finalization-lease";

async function main() {
  const lease = await beginUploadFinalization(process.env.UPLOAD_TEST_ID!, process.env.UPLOAD_TEST_USER!);
  if (process.env.UPLOAD_TEST_TARGET) {
    await lease.beforeWrite({ target: process.env.UPLOAD_TEST_TARGET });
    await writeFile(process.env.UPLOAD_TEST_TARGET, "confirmed fixture bytes");
  }
  process.send?.({ token: lease.token });
  // Simulate work that outlives the initiating HTTP connection.
  setInterval(() => undefined, 1000);
}
main().catch((error: unknown) => { process.send?.({ error: String(error) }); process.exit(1); });
