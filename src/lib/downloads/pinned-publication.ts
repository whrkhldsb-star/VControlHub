import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path/posix";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import type { ClientChannel } from "ssh2";
import { connectSsh, createVerifiedSshConfig, type SshConnectionParams } from "@/lib/ssh/client";
import { shellQuote } from "@/lib/shell-quote";

export type PublicationRoot = { lexical: string; physical: string };

/** The shell retains the approved root, parent, private stage and file through the commit acknowledgement. */
export function pinnedPublicationCommand(remote: string, prefix: string, digest: string,
  root: PublicationRoot = { lexical: "/", physical: "/" }, journal = false) {
  if (!path.isAbsolute(remote) || remote !== path.normalize(remote) || !/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("Invalid relay destination");
  }
  const relative = path.relative(root.physical, path.dirname(remote));
  if (relative === ".." || relative.startsWith("../") || !path.isAbsolute(root.physical)) throw new Error("Invalid relay root");
  const parts = relative.split("/").filter(Boolean).map(shellQuote).join(" ");
  return [
    "set -eu", "umask 077",
    `root=${shellQuote(root.lexical)}`, `expected=${shellQuote(root.physical)}`,
    'cd -P -- "$root" && [ "$(pwd -P)" = "$expected" ] || exit 1', "exec 6<.",
    `for part in ${parts}; do`,
    '  expected="${expected%/}/$part"',
    '  [ -d "./$part" ] || mkdir -- "./$part" || [ -d "./$part" ]',
    '  cd -P -- "./$part" && [ "$(pwd -P)" = "$expected" ] || exit 1',
    "done", "exec 8<.", `name=${shellQuote(path.basename(remote))}`, `digest=${shellQuote(digest)}`,
    'bound() { [ "$root" -ef /proc/self/fd/6 ] && [ "$expected" -ef /proc/self/fd/8 ] && [ ! -L "/proc/self/fd/8/$name" ]; }',
    'version() { stat -Lc "%d:%i:%s:%y:%z" /proc/self/fd/3; }',
    'matches() { [ -f /proc/self/fd/3 ] && checked=$(version) && [ "$(sha256sum </proc/self/fd/3 | cut -d " " -f 1)" = "$digest" ] && [ "$(version)" = "$checked" ]; }',
    'same_file() { [ ! -L "$1" ] && [ "$1" -ef /proc/self/fd/3 ]; }',
    'bound || exit 1',
    'generation() { if [ -f "/proc/self/fd/8/$name" ]; then v=$(stat -Lc "%d:%i:%s:%y:%z" -- "/proc/self/fd/8/$name") || return 1; printf "%s" "$v" | sha256sum | cut -d " " -f 1; elif [ ! -e "/proc/self/fd/8/$name" ]; then echo absent; else return 1; fi; }',
    'original=$(generation)',
    'identity() { stat -Lc "%d:%i:%s:%y" /proc/self/fd/3 | sha256sum | cut -d " " -f 1; }',
    // Recover earlier stages from this task in the pinned parent. A live publisher holds its directory lock.
    `for old in ./${shellQuote(prefix)}*.part; do`,
    '  [ ! -L "$old" ] || continue',
    '  if [ -f "$old" ]; then rm -f -- "$old"; elif [ -d "$old" ]; then (',
    '    cd -P -- "$old" && [ "$(pwd -P)" = "${expected%/}/${old#./}" ] && [ "$(stat -c %u:%a .)" = "$(id -u):700" ] || exit 1',
    '    exec 5<.; flock -xn 5 || exit 0',
    '    rm -f -- body verified; [ "/proc/self/fd/8/$old" -ef . ] && rmdir -- "/proc/self/fd/8/$old"',
    '  ); fi', 'done',
    'if [ -f "./$name" ] && exec 3<"./$name" && matches && same_file "./$name"; then',
    (journal ? '  echo "MATCH $original $(identity)"' : '  echo STAGED') + '; read -r ack && [ "$ack" = COMMIT ] && bound && same_file "./$name" && [ "$(version)" = "$checked" ] || exit 1',
    "  exit 0", "fi",
    `stage=$(mktemp -d -- ${shellQuote("./" + prefix + "XXXXXXXX.part")})`,
    'cd -P -- "$stage" && [ "$(pwd -P)" = "${expected%/}/${stage#./}" ] && [ "$(stat -c %u:%a .)" = "$(id -u):700" ] || exit 1',
    "exec 7<.; flock -x 7",
    'trap \'rm -f -- /proc/self/fd/7/body /proc/self/fd/7/verified; [ "/proc/self/fd/8/$stage" -ef /proc/self/fd/7 ] && rmdir -- "/proc/self/fd/8/$stage"\' EXIT',
    'set -C; exec 3>body; set +C', 'echo UPLOAD',
    'read -r size; case "$size" in ""|*[!0-9]*) exit 1;; esac',
    'head -c "$size" >&3 && [ "$(stat -Lc %s /proc/self/fd/3)" = "$size" ] && matches || exit 1',
    (journal ? 'echo "STAGED $original $(identity)"' : 'echo STAGED') + '; read -r ack && [ "$ack" = COMMIT ] && bound && same_file body && [ "$(version)" = "$checked" ] && [ "$(generation)" = "$original" ] || exit 1',
    // Link the open, verified inode into the private directory. A substituted staging name can never supply the rename.
    'ln -L -- /proc/self/fd/3 verified && chmod 644 /proc/self/fd/3 && mv -fT -- verified "/proc/self/fd/8/$name" && same_file "/proc/self/fd/8/$name"',
  ].join("\n");
}

export type CommitPinned = (rename: () => Promise<void>, state?: { original: string; staged: string; matches: boolean }) => Promise<void>;
export async function publishPinnedFile(ssh: SshConnectionParams, remote: string, prefix: string, digest: string,
  local: string, commit: CommitPinned, signal?: AbortSignal, root?: PublicationRoot) {
  const client = await connectSsh(createVerifiedSshConfig({ ...ssh, enforceHostKeyPin: true }));
  try {
    const channel = await new Promise<ClientChannel>((resolve, reject) =>
      client.exec(pinnedPublicationCommand(remote, prefix, digest, root, true), (error, channel) => error ? reject(error) : resolve(channel)));
    channel.stderr.resume();
    const closed = new Promise<void>((resolve, reject) => {
      channel.once("error", reject);
      channel.once("close", (code: number) => code === 0 ? resolve() : reject(new Error("Remote relay publication failed")));
    });
    void closed.catch(() => {});
    const timeout = new AbortController();
    const active = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    const abort = () => channel.destroy();
    active.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => timeout.abort(new Error("Relay transfer stalled")), 120000);
    try {
      active.throwIfAborted();
      const lines = createInterface({ input: channel, crlfDelay: Infinity });
      for await (const line of lines) {
        active.throwIfAborted();
        timer.refresh();
        if (line === "UPLOAD") {
          const { size } = await stat(local);
          channel.write(String(size) + "\n");
          const read = createReadStream(local, { signal: active });
          read.on("data", () => timer.refresh());
          await pipeline(read, channel, { signal: active, end: false });
        } else if (/^(MATCH|STAGED) (absent|[a-f0-9]{64}) [a-f0-9]{64}$/.test(line)) {
          const [kind, original, staged] = line.split(" ");
          await commit(async () => {
            active.throwIfAborted();
            channel.end("COMMIT\n");
            await closed;
          }, { original: original!, staged: staged!, matches: kind === "MATCH" });
          return;
        } else throw new Error("Invalid relay publication acknowledgement");
      }
      throw new Error("Missing relay publication acknowledgement");
    } finally {
      clearTimeout(timer);
      active.removeEventListener("abort", abort);
      channel.end();
    }
  } finally { client.end(); }
}
