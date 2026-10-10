/**
 * Built-in templates are stored once, under their English name, which also
 * identifies them when seeding. Pages show them in the viewer's language;
 * a team's own templates are shown exactly as written.
 */
export function builtinTemplateKey(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function localizeBuiltinTemplate<T extends { name: string; description?: string | null; isBuiltin?: boolean | null }>(
	template: T,
	translate: (key: string) => string,
): T {
	if (!template.isBuiltin) return template;
	const base = `builtinTemplate.${builtinTemplateKey(template.name)}`;
	const name = translate(`${base}.name`);
	if (name === `${base}.name`) return template;
	const description = translate(`${base}.description`);
	return { ...template, name, description: description === `${base}.description` ? template.description : description };
}
