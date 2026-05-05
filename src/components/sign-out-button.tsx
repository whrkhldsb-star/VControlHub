"use client";

export function SignOutButton() {
	return (
		<form action="/api/auth/signout" method="POST" className="inline w-full">
			<button
				type="submit"
				className="w-full flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm text-rose-200 hover:bg-rose-400/10 transition"
			>
				<span>🚪</span>
				<span>退出登录</span>
			</button>
		</form>
	);
}
