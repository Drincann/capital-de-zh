import type { Metadata } from "next";
import "./globals.css";

const themeBootstrapScript = `
(() => {
  try {
    const saved = localStorage.getItem("capital-reader-theme");
    const theme = saved === "dark" || saved === "light"
      ? saved
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    document.documentElement.dataset.readerTheme = theme;
  } catch {
    document.documentElement.dataset.readerTheme =
      matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
})();
`;

export const metadata: Metadata = {
  title: "《资本论》第一卷",
  description: "《资本论》第一卷译本",
  metadataBase: new URL(
    "https://capital-de-zh-reader.devgaolihai.chatgpt.site",
  ),
  openGraph: {
    title: "《资本论》第一卷",
    description: "《资本论》第一卷译本",
    type: "website",
    images: [
      {
        url: "/reader-social-card.png",
        width: 1536,
        height: 1024,
        alt: "一本摊开的书与简洁的数据图线",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
