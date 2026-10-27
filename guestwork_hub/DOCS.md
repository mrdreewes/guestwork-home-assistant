# GuestWork hub

GuestWork's hub runs inside this Home Assistant. It puts the property's thermostats in GuestWork, where you
can see and set them beside your bookings.

## Linking it

Start from GuestWork: **Devices → Hubs → Add to Home Assistant**, best on a phone with the Home Assistant app. Then
**Add**, **Install** and **Start** here. The app links itself to the property you added it from, and a notification
says so. The thermostats show up on GuestWork's HVAC page a minute later.

It links itself when it asks from the same internet connection the button was tapped on, within 30 minutes. Otherwise
(the phone was on mobile data, or you installed it from here), the notification has a link instead: open it, sign in
to GuestWork if asked, and tap **Link**. If the notification is gone, the link is also in this app's **Log** tab. A
link lasts 30 minutes, and a new one replaces it.

GuestWork names the hub after its property.

## What it reads

- **Home Assistant:** only the thermostats and air conditioners, and the devices they belong to. Home Assistant gives
  any app with access to its API full access. What limits GuestWork to the thermostats is the hub's own list of what
  it may read and do.
- **The router:** the hub finds which router the property has. It reads it only once you add the router's login in
  GuestWork, to count who's on site.
- Nothing listens. The hub only connects out, to GuestWork and to devices on this network.

## Updates

The app updates through Home Assistant. The hub inside it updates itself from GuestWork. Before anything runs, every
file is checked against the release key that ships in this app.

## Unlinking

Unlink it in GuestWork (Devices → Hubs). Everything it sent is deleted. To link it again, restart this app. To remove
it, uninstall the app.

## Backups

The hub's token and keys stay out of Home Assistant's backups. A restored backup asks to be linked again.
