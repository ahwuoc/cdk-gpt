import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The API and shared workspace packages are deliberately imported by the
  // server-only Route Handlers below. Trace from the monorepo root so Vercel
  // includes their source and runtime dependencies in the function bundle.
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  transpilePackages: ["@store/config", "@store/database", "@store/encryption", "@store/shared"],
  // Nest/Fastify uses guarded dynamic requires for optional adapters (views,
  // microservices, websockets). Keeping server-only dependencies external
  // prevents Turbopack from trying to resolve adapters this API does not use.
  serverExternalPackages: [
    "@nestjs/common",
    "@nestjs/core",
    "@nestjs/jwt",
    "@nestjs/mongoose",
    "@nestjs/platform-fastify",
    "@nestjs/swagger",
    "bcryptjs",
    "bullmq",
    "class-transformer",
    "class-validator",
    "fastify",
    "mongoose",
    "reflect-metadata",
    "telegraf",
  ],
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  poweredByHeader: false,
};

export default nextConfig;
