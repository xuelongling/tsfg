// SPDX-License-Identifier: MIT

const net = require("node:net");
const { EventEmitter } = require("node:events");

net.connect = () => {
  const socket = new EventEmitter();
  socket.destroy = () => undefined;
  socket.setTimeout = () => socket;
  process.nextTick(() => socket.emit("connect"));
  return socket;
};
