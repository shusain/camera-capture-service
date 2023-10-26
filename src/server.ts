
const mqtt = require("mqtt");
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const MQTT_BROKER_URL = 'mqtt://192.168.0.11';
const TOPIC = '/irsensor/motion-detected';
const STOP_TOPIC = '/irsensor/motion-stopped';

let isRecording = false;

const client = mqtt.connect(MQTT_BROKER_URL);

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

