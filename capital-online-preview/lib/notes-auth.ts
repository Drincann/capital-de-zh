import { getChatGPTUser } from "@/app/chatgpt-auth";
import { notesOwnerEmail } from "@/lib/runtime-env";

export async function getNotesEditor() {
  const user = await getChatGPTUser();
  if (!user) return { user: null, status: 401 as const };

  const ownerEmail = notesOwnerEmail();
  if (!ownerEmail || user.email.toLowerCase() !== ownerEmail) {
    return { user: null, status: 403 as const };
  }

  return { user, status: 200 as const };
}
