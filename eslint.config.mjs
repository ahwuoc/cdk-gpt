import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  { ignores: ["**/.next/**", "**/node_modules/**", "**/*.tsbuildinfo"] },
  ...nextVitals,
  { rules: { "@next/next/no-html-link-for-pages": "off" } },
];

export default config;
