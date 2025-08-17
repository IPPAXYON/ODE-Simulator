import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ODE Simulator - 微分方程式シミュレーター",
  description:
    "常微分方程式を数値的にシミュレーションできるWebアプリ。",
  keywords: ["微分方程式", "シミュレーション", "物理", "数学", "ODE", "カオス", "カオス理論", "複雑系"],
  openGraph: {
    title: "ODE Simulator - 微分方程式シミュレーター",
    description:
      "常微分方程式を数値的にシミュレーションできるWebアプリ。",
    url: "https://ode-simulator.vercel.app",
    siteName: "ODE Simulator",
    type: "website",
  },
  alternates: {
    canonical: "https://ode-simulator.vercel.app",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
