"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/submit-button";

import { createSshKeyAction, type ServerActionState } from "./actions";

const initialState: ServerActionState = { error: undefined, success: undefined, relatedStorageCount: undefined };

export function SshKeyCreateForm() {
	const [state, formAction] = useActionState(createSshKeyAction, initialState);
	const [selectedPpkFileName, setSelectedPpkFileName] = useState<string | null>(null);

	return (
		<form action={formAction} data-card className="grid gap-4 ">
			<div>
				<h2 className="text-lg font-semibold text-[var(--text-primary)]">添加 SSH 密钥</h2>
				<p className="mt-1 text-xs text-[var(--text-muted)]">用于节点纳管的 SSH 密钥对</p>
			</div>

			{state.error && <div className="rounded-lg bg-rose-500/[0.10] border border-rose-400/20 px-3.5 py-2.5 text-sm text-rose-200">{state.error}</div>}
			{state.success && <div className="rounded-lg bg-emerald-500/[0.10] border border-emerald-400/20 px-3.5 py-2.5 text-sm text-emerald-200">{state.success}</div>}

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="sshKeyName">名称</label>
				<input id="sshKeyName" name="name" type="text" required placeholder="例如 prod-key" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-cyan-400/30 focus:bg-[var(--surface)]/[0.10]" />
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="sshKeyDesc">描述</label>
				<input id="sshKeyDesc" name="description" type="text" placeholder="可选" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-cyan-400/30 focus:bg-[var(--surface)]/[0.10]" />
			</div>

			<div data-tone="cyan" className="rounded-lg border border-cyan-400/15 px-3.5 py-2.5 text-xs leading-relaxed text-[var(--text-primary)]">
				可直接粘贴 OpenSSH 私钥，也可以只上传 PuTTY .ppk 文件；上传 .ppk 时后端会自动转换并提取公钥。
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="privateKey">私钥</label>
				<textarea id="privateKey" name="privateKey" rows={4} placeholder="粘贴 SSH 私钥内容；如果上传 .ppk 可留空" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] font-mono outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-cyan-400/30 focus:bg-[var(--surface)]/[0.10] resize-y" />
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="publicKey">公钥</label>
				<textarea id="publicKey" name="publicKey" rows={2} placeholder="ssh-rsa AAAA..." className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] font-mono outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-cyan-400/30 focus:bg-[var(--surface)]/[0.10] resize-y" />
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide">PuTTY .ppk 上传</label>
				<div className="flex items-center gap-3">
					<label className="cursor-pointer rounded-lg border border-dashed border-[var(--border)]/[0.1] bg-[var(--surface)]/[0.04] px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface)]/[0.04] transition">
						{selectedPpkFileName ?? "选择 .ppk 文件"}
						<input
							type="file"
							name="ppkFile"
							accept=".ppk"
							className="hidden"
							onChange={(e) => {
								const file = e.target.files?.[0];
								setSelectedPpkFileName(file?.name ?? null);
							}}
						/>
					</label>
					{selectedPpkFileName && <span className="text-xs text-[var(--text-muted)]">已选择: {selectedPpkFileName}</span>}
				</div>
			</div>

			<SubmitButton pendingLabel="添加中…">添加密钥</SubmitButton>
		</form>
	);
}
