/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route: Heartbeat / Health Check
  app.get("/api/health", (req, res) => {
    res.json({
      status: "online",
      engines: {
        openai: !!process.env.OPENAI_API_KEY,
        elevenlabs: !!process.env.ELEVENLABS_API_KEY
      }
    });
  });

  // API Route: Fetch Custom & Premade ElevenLabs Voices associated with the API Key
  app.get("/api/elevenlabs-voices", async (req, res) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return res.json({ voices: [] });
    }

    try {
      const response = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: {
          "xi-api-key": apiKey
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch ElevenLabs voices: ${response.statusText}`);
      }
      const data = await response.json();
      return res.json({ voices: data.voices || [] });
    } catch (e: any) {
      console.error("Failed to fetch ElevenLabs voices:", e);
      return res.status(500).json({ error: e.message || "Failed to fetch ElevenLabs voices" });
    }
  });

  // API Route: Stream High-Fidelity Audio Chunks (Dynamic Proxy)
  app.get("/api/tts", async (req, res) => {
    const text = (req.query.text as string) || "";
    const provider = (req.query.provider as string) || "openai";
    const voice = (req.query.voice as string) || "alloy";
    const speed = parseFloat(req.query.speed as string) || 1.0;

    if (!text.trim()) {
      return res.status(400).json({ error: "Text prompt cannot be empty." });
    }

    try {
      if (provider === "openai") {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return res.status(400).json({
            error: "OpenAI API Key is missing. Please declare 'OPENAI_API_KEY' in the Workspace settings to enable crystal-lear human vocals."
          });
        }

        const openAiVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
        const voiceId = openAiVoices.includes(voice) ? voice : "alloy";

        const response = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "tts-1",
            input: text,
            voice: voiceId,
            speed: speed
          })
        });

        if (!response.ok) {
          const errorDetails = await response.text();
          return res.status(response.status).json({ error: `OpenAI Speech error: ${errorDetails}` });
        }

        // Set response headers to stream binary audio
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Transfer-Encoding", "chunked");

        if (response.body) {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
        } else {
          const arrayBuffer = await response.arrayBuffer();
          res.send(Buffer.from(arrayBuffer));
        }

      } else if (provider === "elevenlabs") {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
          return res.status(400).json({
            error: "ElevenLabs API Key is missing. Please declare 'ELEVENLABS_API_KEY' in the Workspace settings to enable studio-quality voices."
          });
        }

        // Accept any valid voice ID passed from the client, defaulting to Rachel
        const voiceId = (voice && /^[a-zA-Z0-9_-]+$/.test(voice)) ? voice : "21m00Tcm4TlvDq8ikWAM";
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`, {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            text: text,
            model_id: "eleven_turbo_v2_5",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75
            }
          })
        });

        if (!response.ok) {
          const errorDetails = await response.text();
          return res.status(response.status).json({ error: `ElevenLabs Speech error: ${errorDetails}` });
        }

        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Transfer-Encoding", "chunked");

        if (response.body) {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
        } else {
          const arrayBuffer = await response.arrayBuffer();
          res.send(Buffer.from(arrayBuffer));
        }

      } else {
        return res.status(400).json({ error: "Unsupported high-fidelity cloud engine provider value." });
      }

    } catch (e: any) {
      console.error("Deep voice generation crash:", e);
      return res.status(500).json({ error: `Server failed to synthesize high-quality voice audio: ${e.message}` });
    }
  });

  // Vite middleware setup for Development Node Lifecycle
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = __dirname; // In dist/server.cjs, __dirname is already the dist folder
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[High-Fidelity Reader Node] Server operating live at http://0.0.0.0:${PORT}`);
  });
}

startServer();
