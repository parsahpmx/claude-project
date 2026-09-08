/**
 * The dashboard is a pure client of the API. It holds no trading state, computes no
 * risk figure, and has no server-side route that could reach the engine directly —
 * a second path to the engine is exactly what the platform's single-authority rule
 * forbids.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_VYRA_API_URL: process.env.NEXT_PUBLIC_VYRA_API_URL ?? "http://localhost:8000",
  },
};

export default nextConfig;
