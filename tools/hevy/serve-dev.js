#!/usr/bin/env node
//
// Serves the generated stats.json over CORS so the theme can render against real
// data locally, where there is no nginx and therefore no /training.json.
//
//   node tools/hevy/serve-dev.js [port]
//
// Point the theme at it from Ghost's code injection (Settings -> Code injection ->
// Site header), which needs no change to the repo:
//
//   <script>window.trainingDataUrl = 'http://localhost:8788/';</script>

import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { DATA_DIR } from './config.js';

const PORT = Number(process.argv[2]) || 8788;
const STATS_PATH = path.join(DATA_DIR, 'stats.json');

const server = http.createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-type', 'application/json');

    try {
        res.end(await fs.readFile(STATS_PATH, 'utf8'));
    } catch {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `no stats.json at ${STATS_PATH}` }));
    }
});

server.listen(PORT, () => {
    console.log(`Serving ${STATS_PATH} on http://localhost:${PORT}/`);
    console.log('Set window.trainingDataUrl to that URL to preview the dashboard.');
});
