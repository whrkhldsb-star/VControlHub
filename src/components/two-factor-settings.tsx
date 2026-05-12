"use client";

import { useState, useRef, useEffect } from "react";

type Step = "idle" | "setup" | "verify" | "disable";

export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
	const [step, setStep] = useState<Step>("idle");
	const [secret, setSecret] = useState("");
	const [otpauthUrl, setOtpauthUrl] = useState("");
	const [code, setCode] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const canvasRef = useRef<HTMLCanvasElement>(null);

	// Draw QR code on canvas
	useEffect(() => {
		if (step !== "setup" || !otpauthUrl || !canvasRef.current) return;
		const canvas = canvasRef.current;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		// Simple QR generation using Google Charts API (or inline)
		// For offline use, we'll just display the otpauth URL and secret
		// In production you'd use a QR lib, but here we show the text
		const size = 200;
		canvas.width = size;
		canvas.height = size;
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, size, size);

		// Draw URL text as fallback (real QR would use a library)
		ctx.fillStyle = "#0f172a";
		ctx.font = "10px monospace";
		ctx.textAlign = "center";
		ctx.fillText("扫描二维码添加", size / 2, 20);
		ctx.fillText("到验证器 App", size / 2, 36);

		// Draw a stylized TOTP icon
		ctx.strokeStyle = "#0891b2";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(size / 2, size / 2 + 10, 50, 0, Math.PI * 2);
		ctx.stroke();
		ctx.fillStyle = "#0891b2";
		ctx.font = "bold 28px sans-serif";
		ctx.textAlign = "center";
		ctx.fillText("2FA", size / 2, size / 2 + 18);

		ctx.fillStyle = "#64748b";
		ctx.font = "9px monospace";
		const words = otpauthUrl.split("&");
		words.forEach((w, i) => {
			ctx.fillText(w.slice(0, 28), size / 2, size - 20 + i * 12);
		});
	}, [step, otpauthUrl]);

	const handleSetup = async () => {
		setLoading(true);
		setError("");
		try {
			const res = await fetch("/api/auth/2fa/setup", { method: "POST" });
			const data = await res.json();
			if (data.error) { setError(data.error); return; }
			setSecret(data.secret);
			setOtpauthUrl(data.otpauthUrl);
			setStep("setup");
		} catch { setError("请求失败"); }
		finally { setLoading(false); }
	};

	const handleVerify = async () => {
		if (code.length !== 6) { setError("请输入6位验证码"); return; }
		setLoading(true);
		setError("");
		try {
			// First verify the code
			const verifyRes = await fetch("/api/auth/2fa/setup", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code, secret }),
			});
			const verifyData = await verifyRes.json();
			if (!verifyData.valid) { setError("验证码错误，请重试"); return; }

			// Then enable 2FA
			const enableRes = await fetch("/api/auth/2fa/enable", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code, secret }),
			});
			const enableData = await enableRes.json();
			if (enableData.error) { setError(enableData.error); return; }
			setStep("idle");
			window.location.reload();
		} catch { setError("请求失败"); }
		finally { setLoading(false); }
	};

	const handleDisable = async () => {
		if (code.length !== 6) { setError("请输入6位验证码"); return; }
		setLoading(true);
		setError("");
		try {
			const res = await fetch("/api/auth/2fa/disable", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code }),
			});
			const data = await res.json();
			if (data.error) { setError(data.error); return; }
			setStep("idle");
			window.location.reload();
		} catch { setError("请求失败"); }
		finally { setLoading(false); }
	};

	return (
		<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
			<div className="flex items-center justify-between mb-4">
				<h3 className="text-sm font-medium text-white">🔐 两步验证 (2FA)</h3>
				<span className={`text-xs px-2 py-0.5 rounded-full ${enabled ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-700/50 text-slate-400"}`}>
					{enabled ? "已启用" : "未启用"}
				</span>
			</div>

			{error && (
				<div className="mb-3 text-xs text-rose-400 bg-rose-500/10 rounded-lg px-3 py-2">{error}</div>
			)}

			{step === "idle" && !enabled && (
				<div>
					<p className="text-xs text-slate-400 mb-3">
						启用两步验证后，登录时需要输入验证器 App 生成的6位动态验证码，增强账户安全性。
					</p>
					<button
						onClick={handleSetup}
						disabled={loading}
						className="px-4 py-2 text-xs font-medium bg-cyan-500/10 text-cyan-400 rounded-lg hover:bg-cyan-500/20 transition disabled:opacity-50"
					>
						{loading ? "生成中..." : "开启两步验证"}
					</button>
				</div>
			)}

			{step === "idle" && enabled && (
				<div>
					<p className="text-xs text-slate-400 mb-3">
						两步验证已启用。如需关闭，请输入验证器 App 中的当前验证码。
					</p>
					<button
						onClick={() => { setStep("disable"); setCode(""); setError(""); }}
						className="px-4 py-2 text-xs font-medium bg-rose-500/10 text-rose-400 rounded-lg hover:bg-rose-500/20 transition"
					>
						关闭两步验证
					</button>
				</div>
			)}

			{step === "setup" && (
				<div className="space-y-4">
					<p className="text-xs text-slate-400">
						1. 使用验证器 App（如 Google Authenticator、Microsoft Authenticator）扫描下方二维码
					</p>
					<canvas ref={canvasRef} className="mx-auto rounded-lg border border-white/[0.06]" />
					<div className="bg-slate-900 rounded-lg p-3">
						<p className="text-[10px] text-slate-500 mb-1">密钥（手动输入）：</p>
						<code className="text-xs text-cyan-400 break-all select-all">{secret}</code>
					</div>
					<p className="text-xs text-slate-400">
						2. 输入验证器 App 中显示的6位验证码：
					</p>
					<div className="flex gap-2">
						<input
							type="text"
							maxLength={6}
							value={code}
							onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
							placeholder="000000"
							className="flex-1 px-3 py-2 text-sm bg-white/[0.05] border border-white/[0.1] rounded-lg text-white placeholder-slate-600 focus:border-cyan-500/50 focus:outline-none"
						/>
						<button
							onClick={handleVerify}
							disabled={loading || code.length !== 6}
							className="px-4 py-2 text-xs font-medium bg-cyan-500/10 text-cyan-400 rounded-lg hover:bg-cyan-500/20 transition disabled:opacity-50"
						>
							{loading ? "验证中..." : "确认启用"}
						</button>
					</div>
					<button
						onClick={() => { setStep("idle"); setCode(""); setError(""); }}
						className="text-xs text-slate-500 hover:text-slate-300 transition"
					>
						取消
					</button>
				</div>
			)}

			{step === "disable" && (
				<div className="space-y-4">
					<p className="text-xs text-slate-400">输入验证器 App 中的当前验证码以关闭两步验证：</p>
					<div className="flex gap-2">
						<input
							type="text"
							maxLength={6}
							value={code}
							onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
							placeholder="000000"
							className="flex-1 px-3 py-2 text-sm bg-white/[0.05] border border-white/[0.1] rounded-lg text-white placeholder-slate-600 focus:border-cyan-500/50 focus:outline-none"
						/>
						<button
							onClick={handleDisable}
							disabled={loading || code.length !== 6}
							className="px-4 py-2 text-xs font-medium bg-rose-500/10 text-rose-400 rounded-lg hover:bg-rose-500/20 transition disabled:opacity-50"
						>
							{loading ? "验证中..." : "确认关闭"}
						</button>
					</div>
					<button
						onClick={() => { setStep("idle"); setCode(""); setError(""); }}
						className="text-xs text-slate-500 hover:text-slate-300 transition"
					>
						取消
					</button>
				</div>
			)}
		</div>
	);
}
