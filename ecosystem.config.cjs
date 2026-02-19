module.exports = {
  apps: [
    {
      name: "seo-monitor",
      script: ".next/standalone/server.js",
      cwd: "/opt/seo-monitor",
      env: {
        NODE_ENV: "production",
        PORT: 3100,
        HOSTNAME: "127.0.0.1",
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
    },
  ],
};
