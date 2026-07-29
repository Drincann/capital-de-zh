import releaseManifest from "@/generated/release-manifest.json";
import { ReaderApp } from "@/app/ReaderApp";
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "@/app/chatgpt-auth";
import { notesOwnerEmail } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  const ownerEmail = notesOwnerEmail();
  const isOwner = Boolean(
    user && ownerEmail && user.email.toLowerCase() === ownerEmail,
  );

  return (
    <ReaderApp
      release={releaseManifest}
      viewer={{
        signedIn: Boolean(user),
        isOwner,
        displayName: user?.displayName || "",
        signInHref: chatGPTSignInPath("/"),
        signOutHref: chatGPTSignOutPath("/"),
      }}
    />
  );
}
