# GuestWork for Home Assistant

[![Add GuestWork hub to my Home Assistant](https://my.home-assistant.io/badges/supervisor_app.svg)](https://my.home-assistant.io/redirect/supervisor_app/?app=762ae854_guestwork_hub&repository_url=https%3A%2F%2Fgithub.com%2Fmrdreewes%2Fguestwork-home-assistant)

One app, **GuestWork hub**. It puts your property's thermostats in [GuestWork](https://guestwork.app), from the Home
Assistant that already runs them.

Start from GuestWork (**Devices → Hubs → Add to Home Assistant**), then tap Add, Install and Start here. It links
itself to that property, and its thermostats show in GuestWork a minute later. Nothing to type.

For Home Assistant OS and Supervised. This repository holds the app's settings and its launcher. The hub itself
comes from GuestWork, to a linked hub only, and each file is checked against the release key in
[guestwork_hub/release-key.pub](guestwork_hub/release-key.pub) before it runs. See [DOCS.md](guestwork_hub/DOCS.md).
