import { DashboardContent } from "./dashboard-content";

export const dynamic = "force-dynamic";

export default async function Home() {
	return DashboardContent({ sessionPath: "/" });
}
