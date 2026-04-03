const fs = require("fs");
const path = require("path");

// Загружаем переменные из .env.production
function loadEnvFile(filePath) {
  const env = {};
  try {
    const content = fs.readFileSync(filePath, "utf8");
    content.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
        const [key, ...valueParts] = trimmed.split("=");
        const value = valueParts.join("=").trim();
        if (key && value) {
          env[key.trim()] = value;
        }
      }
    });
  } catch (error) {
    console.warn(`Warning: Could not load ${filePath}:`, error.message);
  }
  return env;
}

const envVars = loadEnvFile(path.join(__dirname, ".env.production"));

module.exports = {
  apps: [
    {
      name: "visa-monitor-api",
      script: "services/api/dist/main.js",
      cwd: process.cwd(),
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 8989,
        ...envVars,
      },
      error_file: "./logs/api-error.log",
      out_file: "./logs/api-out.log",
      log_file: "./logs/api-combined.log",
      time: true,
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      watch: false,
      max_memory_restart: "500M",
    },
    {
      name: "visa-monitor-parser-resident",
      script: "services/parser/dist/main.js",
      cwd: process.cwd(),
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PARSER_TYPE: "resident",
        PORT: 8991,
        // Прогрев сессий вынесен в отдельный preloader-инстанс
        SESSION_WARMER_INTERVAL_MS: 0,
        ...envVars,
      },
      error_file: "./logs/parser-resident-error.log",
      out_file: "./logs/parser-resident-out.log",
      log_file: "./logs/parser-resident-combined.log",
      time: true,
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      watch: false,
      max_memory_restart: "500M",
    },
    {
      name: "visa-monitor-parser-non-resident",
      script: "services/parser/dist/main.js",
      cwd: process.cwd(),
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PARSER_TYPE: "non-resident",
        PORT: 8992,
        // Прогрев сессий вынесен в отдельный preloader-инстанс
        SESSION_WARMER_INTERVAL_MS: 0,
        ...envVars,
      },
      error_file: "./logs/parser-non-resident-error.log",
      out_file: "./logs/parser-non-resident-out.log",
      log_file: "./logs/parser-non-resident-combined.log",
      time: true,
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      watch: false,
      max_memory_restart: "500M",
    },
    {
      name: "visa-monitor-preloader-resident",
      script: "services/parser/dist/main.js",
      cwd: process.cwd(),
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PARSER_TYPE: "resident",
        PRELOADER_ONLY: "1",
        PORT: 8993,
        // Прогрев раз в 60 минут, TTL 90 минут, minTTL 5 минут
        SESSION_WARMER_INTERVAL_MS: 3600000,
        SESSION_TTL_MS: 5400000,
        SESSION_MIN_TTL_MS: 300000,
        ...envVars,
      },
      error_file: "./logs/preloader-resident-error.log",
      out_file: "./logs/preloader-resident-out.log",
      log_file: "./logs/preloader-resident-combined.log",
      time: true,
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      watch: false,
      max_memory_restart: "400M",
    },
    {
      name: "visa-monitor-preloader-non-resident",
      script: "services/parser/dist/main.js",
      cwd: process.cwd(),
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PARSER_TYPE: "non-resident",
        PRELOADER_ONLY: "1",
        PORT: 8994,
        // Прогрев раз в 60 минут, TTL 90 минут, minTTL 5 минут
        SESSION_WARMER_INTERVAL_MS: 3600000,
        SESSION_TTL_MS: 5400000,
        SESSION_MIN_TTL_MS: 300000,
        ...envVars,
      },
      error_file: "./logs/preloader-non-resident-error.log",
      out_file: "./logs/preloader-non-resident-out.log",
      log_file: "./logs/preloader-non-resident-combined.log",
      time: true,
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      watch: false,
      max_memory_restart: "400M",
    },
  ],
};

