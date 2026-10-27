# GuestWork hub, as a Home Assistant app. Home Assistant builds this on the box it runs on.
# What the hub needs to run, as GuestWork's own hub image has it: Node; ffmpeg for camera clips; Python with numpy and
# paho-mqtt for the panel energy monitor; tzdata, so its days are the property's.
FROM node:22.12-alpine
RUN apk add --no-cache ffmpeg python3 py3-numpy py3-paho-mqtt tzdata
WORKDIR /opt/guestwork
# The launcher, and the key every file of the hub is checked against: this app's own, never one a download brings.
COPY start.mjs release-key.pub ./
# IPv4 first, and no racing of addresses: a short Wi-Fi blip then rides on the network's own retries.
ENV NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"
CMD ["node", "/opt/guestwork/start.mjs"]
