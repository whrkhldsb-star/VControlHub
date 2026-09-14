/** Keep Node-only bootstrap imports inside Next's statically evaluated runtime branch. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { register: registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}
