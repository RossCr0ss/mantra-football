

const nextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.fotmob.com',
      },
    ],
  },
};

export default nextConfig;
