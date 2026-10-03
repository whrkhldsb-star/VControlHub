import { getServerLocale, t } from "@/lib/i18n/translations";
import { IconSearch } from "@/components/nav-icons";
import { ButtonLink } from "@/components/action-button";
import { StatusScreen } from "@/components/page-shell";

export default async function NotFoundPage() {
	const locale = await getServerLocale();
	return (
		<StatusScreen
			className="min-h-[80dvh]"
			icon={<IconSearch />}
			eyebrow={<span className="font-mono">404</span>}
			title={t("notFound.title", locale)}
			description={t("notFound.description", locale)}
			actions={
				<ButtonLink variant="primary" href="/">
					{t("notFound.returnHome", locale)}
				</ButtonLink>
			}
		/>
	);
}
