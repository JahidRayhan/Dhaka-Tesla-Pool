/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export is only switched on for the Netlify deploy (see netlify.toml).
  // Docker Compose keeps running the normal server build with `next start`.
  ...(process.env.STATIC_EXPORT === 'true' ? { output: 'export' } : {}),
};

export default nextConfig;
