import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadReviewDocument } from "./document.js";

export type StartServerOptions = {
  markdownPath: string;
  port: number;
  dev?: boolean;
};

export type StartedServer = {
  app: express.Express;
  server: http.Server;
  url: string;
};

export function startServer(options: StartServerOptions): Promise<StartedServer> {
  const app = express();
  const host = "127.0.0.1";
  const url = `http://${host}:${options.port}`;

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/document", async (_request, response) => {
    try {
      const document = await loadReviewDocument(options.markdownPath);
      response.json(document);
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : "Unable to load document."
      });
    }
  });

  if (!options.dev) {
    const webDir = getWebDir();
    app.use(express.static(webDir));
    app.use((request, response, next) => {
      if (request.method !== "GET") {
        next();
        return;
      }
      response.sendFile(path.join(webDir, "index.html"));
    });
  }

  return new Promise((resolve, reject) => {
    const server = app.listen(options.port, host, () => {
      resolve({ app, server, url });
    });

    server.on("error", reject);
  });
}

function getWebDir(): string {
  const filename = fileURLToPath(import.meta.url);
  const dirname = path.dirname(filename);
  return path.resolve(dirname, "../web");
}
