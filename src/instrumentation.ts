export async function register() {
  // Load BigInt serialization patch early
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/bigint-patch");
  }
}
