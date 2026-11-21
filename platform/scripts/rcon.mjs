#!/usr/bin/env node
/**
 * Minimal Minecraft RCON client for local Paper testing.
 *   node scripts/rcon.mjs [--port 25575] [--password bh-test-rcon] "command" ["command"...]
 */
import net from "node:net";

const args = process.argv.slice(2);
let port = 25575;
let password = "bh-test-rcon";
const commands = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port") port = Number(args[++i]);
  else if (args[i] === "--password") password = args[++i];
  else commands.push(args[i]);
}

const packet = (id, type, body) => {
  const payload = Buffer.from(body, "utf8");
  const buffer = Buffer.alloc(14 + payload.length);
  buffer.writeInt32LE(10 + payload.length, 0);
  buffer.writeInt32LE(id, 4);
  buffer.writeInt32LE(type, 8);
  payload.copy(buffer, 12);
  buffer.writeInt16LE(0, 12 + payload.length);
  return buffer;
};

const socket = net.createConnection({ host: "127.0.0.1", port });
let buffer = Buffer.alloc(0);
let authenticated = false;
let pending = [];
let authResolve;
let authReject;
let resolveAuth = new Promise((resolve, reject) => {
  authResolve = resolve;
  authReject = reject;
});

socket.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 12) {
    const length = buffer.readInt32LE(0);
    if (buffer.length < length + 4) break;
    const id = buffer.readInt32LE(4);
    const type = buffer.readInt32LE(8);
    const body = buffer.subarray(12, 4 + length - 2).toString("utf8");
    buffer = buffer.subarray(length + 4);
    if (type === 2) {
      if (!authenticated) {
        authenticated = true;
        if (id === -1) authReject(new Error("RCON authentication failed"));
        else authResolve();
      }
    } else if (type === 0 && authenticated) {
      const waiter = pending.shift();
      if (waiter) waiter(body);
    }
  }
});

socket.on("error", (error) => {
  console.error("RCON error:", error.message);
  process.exit(1);
});

function command(body) {
  return new Promise((resolve) => {
    pending.push(resolve);
    socket.write(packet(2, 2, body));
  });
}

try {
  socket.write(packet(1, 3, password));
  await resolveAuth;
  for (const cmd of commands) {
    const output = await command(cmd);
    console.log(`> ${cmd}`);
    console.log(output.replace(/\u00a7./g, "").trim());
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  socket.end();
}
