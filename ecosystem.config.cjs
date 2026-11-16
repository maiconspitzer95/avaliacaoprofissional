module.exports = {
  apps: [
    {
      name: "avaliacao-desempenho",
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      cwd: __dirname,
      env: { NODE_ENV: "production", PORT: "5005", HOST: "0.0.0.0" },
      time: true,
      max_memory_restart: "512M",
    },
  ],
};
