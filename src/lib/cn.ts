/**
 * cn — className 条件合并工具。
 * clsx 已在 Next.js 依赖链内，0 新包。
 *
 * 用法：
 *   cn("base", isActive && "bg-cyan-500", className)
 */
import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
	return clsx(...inputs);
}
