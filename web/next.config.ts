import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // dev 서버를 다른 PC에서 열 때 HMR 허용. IP는 .env.local의 JETSON_IP (Git 제외)
  allowedDevOrigins: process.env.JETSON_IP ? [process.env.JETSON_IP] : [],
  // 브라우저는 같은 주소의 /sta만 호출하고, Next 서버가 Jetson 내부 FROST로 전달한다.
  // 그래서 LAN IP든 Tailscale IP든 3000 포트 하나로 접속된다.
  rewrites: async () => [
    { source: "/sta/:path*", destination: "http://localhost:8080/FROST-Server/v1.1/:path*" },
  ],
};

export default nextConfig;
