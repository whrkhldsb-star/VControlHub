// The anonymous status endpoint also returns HTTP 200 for a database outage.
try {
  const response = await fetch(process.argv[2], {
    redirect: "error",
    signal: AbortSignal.timeout(4000),
  });
  const status = response.ok ? (await response.json()).summary?.overall : undefined;
  if (status !== "healthy" && status !== "warning") process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
