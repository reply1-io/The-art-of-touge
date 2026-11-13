# The Art of Touge — multiplayer

## The easy way: host from the game (no server needed)

Open the menu, type your name under **Online** and tap **HOST GAME**. You get a five-character
code. Your friends type it in the **CODE** box and tap **JOIN**.

You are in charge of the room: the **Road** and **Time** you pick are used by everyone, and if
you change them while hosting, everyone follows you. The room ends when you tap **END GAME** or
close the game. Up to 8 drivers.

This uses PeerJS's free public matchmaking service only to introduce the phones to each other;
after that the game talks directly between them.

## Your own server (optional)


A small relay server. Players on the same road see each other's cars (with their paint, wheels,
plates and so on), can bump into each other, and can chat. Each game runs its own physics; the
server only passes car positions along.

## Run it on your computer

Needs [Node.js](https://nodejs.org) 18 or newer.

```sh
cd server
npm install
npm start
```

It listens on port 8080. In the game, open the menu, type your computer's address in **Online → Own
server** (for example `192.168.1.20:8080` on your home Wi-Fi) and press **CONNECT**.

Settings (environment variables):

| Variable      | Default        | What it does                       |
| ------------- | -------------- | ---------------------------------- |
| `PORT`        | `8080`         | Port to listen on                  |
| `SERVER_NAME` | `Touge server` | Name shown to players              |
| `MAX_PLAYERS` | `12`           | Players allowed on each road       |
| `ROAD`        | (players pick) | `akina` or `dragon`: everyone on one road |
| `TIME`        | (players pick) | `day`, `sunset` or `night` for everyone   |

## Playing from the GitHub Pages version

The game on GitHub Pages is served over HTTPS, and browsers only let an HTTPS page connect to a
**secure** server (`wss://`). A plain server on your home network works with the game when you
run the game locally (`npm run dev`), but from GitHub Pages you need the server on a host that
gives you HTTPS. Free and cheap options that work as-is:

- **Render** (render.com): New → Web Service → this repository, *Root directory* `server`,
  *Build command* `npm install`, *Start command* `npm start`. You get an address like
  `touge-server.onrender.com`; type that into the game.
- **Railway** or **Fly.io** work the same way: point them at the `server` folder.

Anyone with the address can join. Share it with your friends and pick the same road.
