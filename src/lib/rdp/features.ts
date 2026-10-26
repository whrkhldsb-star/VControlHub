/**
 * Optional RDP channel features. Both are read per connection so a deployment
 * can flip them without restarting the WebSocket service.
 *
 * - Clipboard sync (text/plain only, both directions) is ON by default: the
 *   bridge keeps strict stream validation, so this restores the parity a
 *   native RDP client (rdclient/mstsc) has without opening file or pipe
 *   channels.
 * - Remote audio stays OFF by default; enabling it requires a guacd build
 *   with FreeRDP audio and enough bandwidth headroom.
 */
export function rdpClipboardEnabled() {
 return process.env.RDP_ENABLE_CLIPBOARD !== "false";
}

export function rdpAudioEnabled() {
 return process.env.RDP_AUDIO_ENABLED === "true";
}

/**
 * Image formats the gateway tells guacd the browser takes. With WebP among
 * them guacd encodes the regions that change often (video, scrolling) as WebP
 * instead of JPEG — fewer bytes at the same quality, more CPU on the hub;
 * still pictures stay PNG. Settings → runtime ("rdp.webpImages"); empty
 * follows RDP_WEBP_IMAGES, off by default. Read per connection.
 */
export async function rdpImageMimetypes(): Promise<string[]> {
 const { getSetting } = await import("@/lib/settings/service");
 const stored = (await getSetting("rdp.webpImages").catch(() => "")).trim().toLowerCase();
 const webp = stored === "true" || (stored !== "false" && process.env.RDP_WEBP_IMAGES === "true");
 return webp ? ["image/png", "image/jpeg", "image/webp"] : ["image/png", "image/jpeg"];
}

/** Raw PCM mimetypes guacamole-common-js can play natively (Web Audio API). */
export const RDP_AUDIO_MIMETYPES = ["audio/L8;rate=44100", "audio/L16;rate=44100", "audio/L16;rate=48000"];
