
const mqtt = require("mqtt");
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';


const app = express();
const PORT = 3001; // You can change the port number if needed

const MQTT_BROKER_URL = 'mqtt://192.168.0.11';
const TOPIC = '/irsensor/motion-detected';
const STOP_TOPIC = '/irsensor/motion-stopped';

let isRecording = false;

const client = mqtt.connect(MQTT_BROKER_URL);

app.use(cors({ origin: 'http://localhost' }));

client.on('connect', () => {
    console.log('Connected to MQTT broker');
    client.subscribe(TOPIC);
    client.subscribe(STOP_TOPIC);
});

client.on('message', async (topic:string, message:string) => {
    if (topic === TOPIC) {
        isRecording = true;
        const ipAddress = message.toString();
        console.log(`Motion detected. Capturing images from http://${ipAddress}:81/stream`);
        await captureImagesFromCamera(ipAddress);
    } else if (topic === STOP_TOPIC) {
        isRecording = false;
        console.log('Motion stopped. Stopping image capture.');
    }
});

async function captureImagesFromCamera(ip: string) {
    const startTime = Date.now();
    while (isRecording && (Date.now() - startTime) < 10000) {
        try {
            console.error(`Getting images from stream`);
            const response = await axios.get(`http://${ip}:80/capture`, { responseType: 'arraybuffer' });
            const timestamp = new Date().toISOString();
            fs.writeFileSync(path.join(__dirname, '..', 'captured_images', `${timestamp}.jpg`), response.data);
            console.error(`Saved image to file`+path.join(__dirname, '..', 'captured_images', `${timestamp}.jpg`));
        } catch (error:any) {
            console.error(`Error fetching image: ${error.message}`);
        }
        // Over 60s timeout capture
        if((Date.now() - startTime) > 60000) {
            return;
        }
        await new Promise(res => setTimeout(res, 100)); // Delay for 500ms before capturing the next image.
    }
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