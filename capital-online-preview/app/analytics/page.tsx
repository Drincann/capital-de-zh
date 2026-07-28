import { AnalyticsDashboard } from "@/app/analytics/AnalyticsDashboard";
import { analyticsSummary } from "@/lib/analytics";
import { requireAnalyticsOwner } from "@/lib/analytics-auth";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const user = await requireAnalyticsOwner();
  if (!user) notFound();
  const summary = await analyticsSummary();

  return <AnalyticsDashboard summary={summary} owner={user.email} />;
}
