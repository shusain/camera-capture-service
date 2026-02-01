
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
const CAPTURE_DIR = process.env.CAPTURE_DIR || path.join('/data', 'captured_images');
const MODE = (process.env.CAPTURE_MODE || 'capture').toLowerCase(); // 'stream' or 'capture'
const DURATION_MS = parseInt(process.env.CAPTURE_DURATION_MS || '10000', 10);
const INTERVAL_MS = parseInt(process.env.CAPTURE_INTERVAL_MS || '100', 10);
const STREAM_PORT = parseInt(process.env.STREAM_PORT || '80', 10);
const STREAM_PATH = process.env.STREAM_PATH || '/stream';

let isRecording = false;

const client = mqtt.connect(MQTT_BROKER_URL);

app.use(cors({ origin: ['http://localhost', 'http://workhorse.shauncore.com:8080', 'http://ubuntu-workhorse.local:8080'] }));

// Ensure capture dir exists
try { fs.mkdirSync(CAPTURE_DIR, { recursive: true }); } catch {}

client.on('connect', () => {
    console.log('Connected to MQTT broker');
    client.subscribe(TOPIC);
    client.subscribe(STOP_TOPIC);
});

client.on('message', async (topic:string, message:Buffer) => {
    if (topic === TOPIC) {
        const ipAddress = message.toString().trim();
        if (!ipAddress) return;
        isRecording = true;
        console.log(`Motion detected from ${ipAddress}. Mode=${MODE}`);
        try {
            if (MODE === 'stream') {
                await captureFromMjpegStream(ipAddress);
            } else {
                await captureStillSnapshots(ipAddress);
            }
        } catch (e:any) {
            console.error('Capture error:', e?.message || e);
        }
    } else if (topic === STOP_TOPIC) {
        isRecording = false;
        console.log('Motion stopped. Stopping image capture.');
    }
});

async function captureStillSnapshots(ip: string) {
    const startTime = Date.now();
    while (isRecording && (Date.now() - startTime) < DURATION_MS) {
        try {
            const response = await axios.get(`http://${ip}:80/capture`, { responseType: 'arraybuffer', timeout: 3000 });
            const timestamp = new Date().toISOString().replace(/[:.]/g,'-');
            const file = path.join(CAPTURE_DIR, `${ip.replace(/\./g,'_')}_${timestamp}.jpg`);
            fs.writeFileSync(file, response.data);
            console.log(`Saved still: ${file}`);
        } catch (error:any) {
            console.error(`Still fetch error: ${error.message}`);
        }
        if ((Date.now() - startTime) > 60000) return; // safety cap
        await new Promise(res => setTimeout(res, INTERVAL_MS));
    }
}

async function captureFromMjpegStream(ip: string) {
    return new Promise<void>((resolve) => {
        const url = `http://${ip}:${STREAM_PORT}${STREAM_PATH}`;
        const req = http.get(url, (res) => {
            const contentType = res.headers['content-type'] || '';
            // Expect multipart/x-mixed-replace; boundary=... 
            const m = /boundary=(.*)$/i.exec(contentType.toString());
            const boundary = m ? `--${m[1]}` : '--boundary';
            let buffer = Buffer.alloc(0);
            const startTime = Date.now();
            res.on('data', (chunk) => {
                if (!isRecording || (Date.now() - startTime) > DURATION_MS) {
                    req.destroy();
                    resolve();
                    return;
                }
                buffer = Buffer.concat([buffer, chunk]);
                let idx;
                while ((idx = buffer.indexOf(boundary)) !== -1) {
                    const part = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + boundary.length);
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
        req.on('error', () => resolve());
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