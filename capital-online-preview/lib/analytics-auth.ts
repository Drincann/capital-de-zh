import { getChatGPTUser, chatGPTSignInPath } from "@/app/chatgpt-auth";
import { analyticsOwnerEmail } from "@/lib/runtime-env";
import { redirect } from "next/navigation";

export async function requireAnalyticsOwner() {
  const user = await getChatGPTUser();
  if (!user) redirect(chatGPTSignInPath("/analytics"));

  const owner = analyticsOwnerEmail();
  if (!owner || user.email.toLowerCase() !== owner) return null;
  return user;
}
