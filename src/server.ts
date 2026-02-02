
const mqtt = require("mqtt");
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import http from 'http';

const app = express();
const PORT = 3001; // You can change the port number if needed

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://192.168.0.42';
const TOPIC = process.env.MQTT_TOPIC || '/irsensor/motion-detected';
const STOP_TOPIC = process.env.MQTT_STOP_TOPIC || '/irsensor/motion-stopped';
// Also listen to device-scoped PIR topic (e.g., espXXXX/sensor/pir)
const PIR_TOPIC = process.env.PIR_TOPIC || '+/sensor/pir';
const CAPTURE_DIR = process.env.CAPTURE_DIR || path.join('/data', 'captured_images');
const DURATION_MS = parseInt(process.env.CAPTURE_DURATION_MS || '10000', 10);
const STREAM_PORT = parseInt(process.env.STREAM_PORT || '80', 10);
const STREAM_PATH = process.env.STREAM_PATH || '/stream';

let isRecording = false;
let sessionStartMs = 0;
let lastPirFalseMs = 0;
let stopTimer: NodeJS.Timeout | null = null;
let activeIp: string | null = null;
let capturing = false; // prevent overlapping captures
const MAX_SESSION_MS = 60_000; // cap at 1 minute total

const client = mqtt.connect(MQTT_BROKER_URL);

app.use(express.json());
app.use(cors({ origin: ['http://localhost', 'http://workhorse.shauncore.com:8080', 'http://ubuntu-workhorse.local:8080'] }));

// Ensure capture dir exists
try { fs.mkdirSync(CAPTURE_DIR, { recursive: true }); } catch {}

client.on('connect', () => {
    console.log('Connected to MQTT broker');
    client.subscribe(TOPIC);
    client.subscribe(STOP_TOPIC);
    client.subscribe(PIR_TOPIC); // wildcard for device PIR events
});

function extractIpFromPayload(raw: Buffer): string | null {
    const text = raw.toString().trim();
    if (!text) return null;
    // Accept plain IP, JSON with ip or stream_url, or legacy "camera:NAME" (ignored)
    try {
        const obj = JSON.parse(text);
        if (typeof obj === 'object' && obj) {
            if (typeof obj.ip === 'string') return obj.ip;
            if (typeof obj.stream_url === 'string') {
                try { const u = new URL(obj.stream_url); return u.hostname; } catch {}
            }
            if (typeof obj.url === 'string') {
                try { const u = new URL(obj.url); return u.hostname; } catch {}
            }
        }
    } catch {}
    // Plain IPv4
    if (/^\d+\.\d+\.\d+\.\d+$/.test(text)) return text;
    // camera:cam1 or event:start → not usable to derive IP
    return null;
}

function scheduleStopTimer() {
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
        const now = Date.now();
        const postFalseElapsed = lastPirFalseMs ? (now - lastPirFalseMs) : 0;
        const sessionElapsed = sessionStartMs ? (now - sessionStartMs) : 0;
        if ((postFalseElapsed >= 10_000 || !isRecording) || sessionElapsed >= MAX_SESSION_MS) {
            isRecording = false;
            activeIp = null;
        } else {
            // Not ready to stop yet; reschedule a short check
            scheduleStopTimer();
        }
    }, 1000);
}

client.on('message', async (topic:string, message:Buffer) => {
    try {
        if (topic === TOPIC) {
            const ipAddress = extractIpFromPayload(message);
            if (!ipAddress) { console.warn('Motion payload did not contain a resolvable IP'); return; }
            // Start (or extend) session
            activeIp = ipAddress;
            const now = Date.now();
            if (!isRecording) { sessionStartMs = now; }
            isRecording = true;
            scheduleStopTimer();
            console.log(`Motion detected from ${ipAddress}. Streaming from http://${ipAddress}:${STREAM_PORT}${STREAM_PATH}`);
            if (!capturing) { capturing = true; await captureFromMjpegStream(ipAddress); capturing = false; }
            return;
        }
        if (topic === STOP_TOPIC) {
            lastPirFalseMs = Date.now();
            scheduleStopTimer();
            console.log('Motion stopped (legacy topic). Will stop after grace period.');
            return;
        }
        // Handle device-scoped PIR topic e.g. espXXXX/sensor/pir with JSON {pir, ip, stream_url}
        if (topic.endsWith('/sensor/pir')) {
            const text = message.toString().trim();
            let obj: any = null;
            try { obj = JSON.parse(text); } catch {}
            if (!obj || typeof obj.pir !== 'boolean') return;
            if (obj.pir) {
                const ipAddress = extractIpFromPayload(message);
                if (!ipAddress) { console.warn('PIR JSON missing resolvable IP'); return; }
                activeIp = ipAddress;
                const now = Date.now();
                if (!isRecording) { sessionStartMs = now; }
                isRecording = true;
                scheduleStopTimer();
                console.log(`PIR start from ${ipAddress}. Streaming from http://${ipAddress}:${STREAM_PORT}${STREAM_PATH}`);
                if (!capturing) { capturing = true; await captureFromMjpegStream(ipAddress); capturing = false; }
            } else {
                lastPirFalseMs = Date.now();
                scheduleStopTimer();
                console.log('PIR stop received. Will stop after grace period.');
            }
            return;
        }
    } catch (e:any) {
        console.error('MQTT message handler error:', e?.message || e);
    }
});

async function captureFromMjpegStream(ip: string) {
    return new Promise<void>((resolve) => {
        const startTime = Date.now();
        const url = `http://${ip}:${STREAM_PORT}${STREAM_PATH}`;
        const req = http.get(url, (res) => {
            if ((res.statusCode || 0) >= 400) {
                console.error(`Stream fetch error: ${res.statusCode} ${STREAM_PATH}`);
                req.destroy();
                return resolve();
            }
            const contentType = (res.headers['content-type'] || '').toString();
            const m = /boundary=(.*)$/i.exec(contentType);
            const boundary = m ? `--${m[1]}` : '--frame';
            let buffer = Buffer.alloc(0);
            res.on('data', (chunk) => {
                const now = Date.now();
                const sessionElapsed = now - sessionStartMs;
                const postFalseElapsed = lastPirFalseMs ? (now - lastPirFalseMs) : 0;
                const shouldStop = (!isRecording && postFalseElapsed > 10_000) || (sessionElapsed > MAX_SESSION_MS);
                if (shouldStop) { req.destroy(); resolve(); return; }
                buffer = Buffer.concat([buffer, chunk]);
                let idxB;
                while ((idxB = buffer.indexOf(boundary)) !== -1) {
                    const part = buffer.slice(0, idxB);
                    buffer = buffer.slice(idxB + boundary.length);
                    const headerEnd = part.indexOf('\r\n\r\n');
                    if (headerEnd !== -1) {
                        const body = part.slice(headerEnd + 4);
                        if (body.length > 1000) {
                            const timestamp = new Date().toISOString().replace(/[:.]/g,'-');
                            const file = path.join(CAPTURE_DIR, `${ip.replace(/\./g,'_')}_${timestamp}.jpg`);
                            try { fs.writeFileSync(file, body); console.log(`Saved frame: ${file}`);} catch {}
                        }
                    }
                }
            });
            res.on('end', () => resolve());
            res.on('error', () => resolve());
        });
        req.on('error', (e) => { console.error(`Stream connect error: ${e.message}`); resolve(); });
    });
}

// Endpoint to get a list of all captured images and total file size
app.get('/images', (req, res) => {
    const directoryPath = path.join(__dirname, '..', 'captured_images');
    
    fs.readdir(directoryPath, (err, files) => {
        if (err) {
            return res.status(500).send({ error: "Unable to read directory" });
        }

        let totalSize = 0;
        const imageLinks = files.map(file => {
            const filePath = path.join(directoryPath, file);
            totalSize += fs.statSync(filePath).size;
            return {
                name: file,
                link: `/image/${file}`
            };
        });

        res.send({
            images: imageLinks,
            totalSize
        });
    });
});

// Endpoint to get an individual image
app.get('/image/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, '..', 'captured_images', filename);
    
    fs.exists(filePath, (exists) => {
        if (!exists) {
            return res.status(404).send({ error: "Image not found" });
        }
        res.sendFile(filePath);
    });
});

app.listen(PORT, () => {
    console.log(`Express server running on http://localhost:${PORT}`);
});
