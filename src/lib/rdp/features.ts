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

/** Raw PCM mimetypes guacamole-common-js can play natively (Web Audio API). */
export const RDP_AUDIO_MIMETYPES = ["audio/L8;rate=44100", "audio/L16;rate=44100", "audio/L16;rate=48000"];
