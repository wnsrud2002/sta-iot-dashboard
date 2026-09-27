import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Sans_KR({ weight: ["300", "400", "600"], subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Lab Desk 온습도",
  description: "ESP32 DHT11 센서의 실시간 온도·습도 (OGC SensorThings API)",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={plex.className}>
      <body>{children}</body>
    </html>
  );
}
