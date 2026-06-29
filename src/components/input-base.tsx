/**
 * InputBase — 统一的表单输入组件。
 * 解决项目中 3 种 input className 变体并存问题。
 *
 * 用法：
 *   <InputBase placeholder="请输入..." />
 *   <InputBase as="textarea" rows={4} />
 *   <InputBase size="sm" />
 */
import { forwardRef } from "react";

const BASE =
	"w-full rounded-lg border bg-[var(--input-bg)] text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--input-border-focus)] focus:shadow-[0_0_0_3px_var(--accent-bg)] disabled:opacity-50";

const SIZE = {
	sm: "px-3 py-1.5",
	md: "px-3.5 py-2.5",
	lg: "px-4 py-3",
} as const;

type BaseProps = {
	size?: keyof typeof SIZE;
	className?: string;
};

type InputProps = BaseProps &
	Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & { as?: "input" };

type TextareaProps = BaseProps &
	React.TextareaHTMLAttributes<HTMLTextAreaElement> & { as: "textarea" };

type SelectProps = BaseProps &
	React.SelectHTMLAttributes<HTMLSelectElement> & { as: "select"; children: React.ReactNode };

export type InputBaseProps = InputProps | TextareaProps | SelectProps;

export const InputBase = forwardRef<
	HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
	InputBaseProps
>(({ size = "md", className = "", ...props }, ref) => {
	const cls = `${BASE} ${SIZE[size]} ${className}`;

	if (props.as === "textarea") {
		const { as: _as, size: _sz, ...rest } = props as TextareaProps;
		return <textarea ref={ref as React.Ref<HTMLTextAreaElement>} className={cls} {...rest} />;
	}
	if (props.as === "select") {
		const { as: _as, size: _sz, ...rest } = props as SelectProps;
		return <select ref={ref as React.Ref<HTMLSelectElement>} className={cls} {...rest} />;
	}
	const { as: _as, size: _sz, ...rest } = props as InputProps;
	return <input ref={ref as React.Ref<HTMLInputElement>} className={cls} {...rest} />;
});

InputBase.displayName = "InputBase";
