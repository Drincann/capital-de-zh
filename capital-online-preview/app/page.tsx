import releaseManifest from "@/generated/release-manifest.json";
import { ReaderApp } from "@/app/ReaderApp";

export default function Home() {
  return <ReaderApp release={releaseManifest} />;
}
