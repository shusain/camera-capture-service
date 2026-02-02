# Camera Capture Server

Subscribes to MQTT motion topics and captures images from ESP32-CAM streams.

- MQTT broker: `MQTT_BROKER_URL` (default `mqtt://192.168.0.42`)
- Topics supported:
  - Legacy: `MQTT_TOPIC` (default `/irsensor/motion-detected`) payload: camera IP (e.g., `192.168.0.122`)
  - Legacy stop: `MQTT_STOP_TOPIC` (default `/irsensor/motion-stopped`)
  - Firmware PIR JSON: `+/sensor/pir` (e.g., `espXXXX/sensor/pir`) payload JSON:
    ```json
    { "pir": true|false, "ts": <ms>, "ip": "<cam-ip>", "stream_url": "http://<cam-ip>/stream" }
    ```
    The server extracts `ip` (or hostname from `stream_url`).
- Capture dir: `CAPTURE_DIR` (default `/data/captured_images`)
- Stream config: `STREAM_PORT` (default `80`), `STREAM_PATH` (default `/stream`)

## Behavior
- On PIR start (true) or motion-detected: begin capturing MJPEG frames.
- On PIR stop (false): continue capturing for a 10s grace window, then stop.
- Session cap: at most 60s of continuous capture per trigger window.
- JSON payloads with `{ip}` or `{stream_url}` are accepted; plain IP strings continue to work.

## Run (Docker)
```
docker run --rm \
  -e MQTT_BROKER_URL=mqtt://192.168.0.42 \
  -e CAPTURE_DIR=/data/captured_images \
  -v /mnt/NAS/captures:/data \
  registry.shaun-husain.com/camera-capture-server:latest
```

## K8s
- Namespace: `automation`
- PVC: `capture-pvc-hostpath` (10Gi) → mount at `/data`
- Service: ClusterIP on port 3001
- Deployment uses `imagePullPolicy: Always` and image `registry.shaun-husain.com/camera-capture-server:latest`

## Dev
```
npm ci
npm run dev
```

## Notes
- Ensure `/mnt/NAS/captures` exists and is writable by kubelet on the node.
- Broker must be reachable at `192.168.0.42:1883` (or set `MQTT_BROKER_URL`).
- JSON topic `+/sensor/pir` is subscribed by default; override via `PIR_TOPIC` if needed.
