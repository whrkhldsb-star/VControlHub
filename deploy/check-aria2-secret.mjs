// Installed runtimes also check on startup, since .env.local can change after install.
const secret = process.env.ARIA2_RPC_SECRET?.trim();
if (!secret && process.argv.includes("--require-secret")) throw new Error("ARIA2_RPC_SECRET is required");
if (secret && /REPLACE_WITH|CHANGE_ME|CHANGE_THIS|(?:^|_)default_token$/i.test(secret)) {
  throw new Error("ARIA2_RPC_SECRET contains a production placeholder");
}
