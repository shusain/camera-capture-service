# Camera Capture Server

Subscribes to MQTT motion topics and captures images from ESP32-CAM streams.

- MQTT broker: configurable via `MQTT_BROKER_URL` (default `mqtt://192.168.0.42`)
- Topics:
  - `MQTT_TOPIC` (default `/irsensor/motion-detected`) payload: camera IP
  - `MQTT_STOP_TOPIC` (default `/irsensor/motion-stopped`)
- Capture dir: `CAPTURE_DIR` (default `/data/captured_images`)

## Run (Docker)
```
docker run --rm -e MQTT_BROKER_URL=mqtt://192.168.0.42 -v /mnt/NAS/captures:/data \
  registry.shaun-husain.com/camera-capture-server:latest
```

## K8s
- Manifests in `k8s/` (namespace `automation`)
- PV hostPath `/mnt/NAS/captures` → PVC `capture-pvc-hostpath`
- Service ClusterIP on 3001

## Dev
```
npm ci
npm run dev
```
