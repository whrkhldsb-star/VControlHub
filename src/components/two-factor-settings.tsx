"use client";

import Image from "next/image";
import { useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

type Step = "idle" | "setup" | "verify" | "disable";

export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
	const [step, setStep] = useState<Step>("idle");
	const [secret, setSecret] = useState("");
	const [otpauthUrl, setOtpauthUrl] = useState("");
	const [code, setCode] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	// QR code rendered via Google Charts API (replaces canvas placeholder)

	const messageFromError = (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback;

	const handleSetup = async () => {
		setLoading(true);
		setError("");
		try {
			const data = await csrfFetch("/api/auth/2fa/setup", { method: "POST" });
			if (data.error) { setError(data.error); return; }
			setSecret(data.secret);
			setOtpauthUrl(data.otpauthUrl);
			setStep("setup");
		} catch (err) { setError(messageFromError(err, "请求失败")); }
		finally { setLoading(false); }
	};

	const handleVerify = async () => {
		if (code.length !== 6) { setError("请输入6位验证码"); return; }
		setLoading(true);
		setError("");
		try {
			// First verify the code
			const verifyData = await csrfFetch("/api/auth/2fa/setup", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code, secret }),
			});
			if (!verifyData.valid) { setError("验证码错误，请重试"); return; }

			// Then enable 2FA
			const enableData = await csrfFetch("/api/auth/2fa/enable", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code, secret }),
			});
			if (enableData.error) { setError(enableData.error); return; }
			setStep("idle");
			window.location.reload();
		} catch (err) { setError(messageFromError(err, "请求失败")); }
		finally { setLoading(false); }
	};

	const handleDisable = async () => {
		if (code.length !== 6) { setError("请输入6位验证码"); return; }
		setLoading(true);
		setError("");
		try {
			const data = await csrfFetch("/api/auth/2fa/disable", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code }),
			});
			if (data.error) { setError(data.error); return; }
			setStep("idle");
			window.location.reload();
		} catch (err) { setError(messageFromError(err, "请求失败")); }
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
				<div role="alert" className="mb-3 text-xs text-rose-400 bg-rose-500/10 rounded-lg px-3 py-2">{error}</div>
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
					<Image
						src={`https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(otpauthUrl)}`}
						alt="2FA QR Code"
						className="mx-auto rounded-lg border border-white/[0.06]"
						width={200}
						height={200}
						unoptimized
					/>
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
