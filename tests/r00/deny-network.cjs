// SPDX-License-Identifier: MIT

const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

function denyNetwork() {
  throw new Error("verify-workspace attempted forbidden network access");
}

global.fetch = denyNetwork;
http.request = denyNetwork;
http.get = denyNetwork;
https.request = denyNetwork;
https.get = denyNetwork;
net.connect = denyNetwork;
net.createConnection = denyNetwork;
net.Socket.prototype.connect = denyNetwork;
