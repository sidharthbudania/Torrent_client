

'use strict';

const dgram = require('dgram');
const Buffer = require('buffer').Buffer;
const urlParse = require('url').parse;
const crypto = require('crypto');
const torrentParser = require('./torrent-parser');
const util = require('./util');
const http = require('http');
const https = require('https');
const bencode = require('bencode');

module.exports.getPeers = (torrent, port = 6881, stats = {}, callback) => {
  if (typeof port === 'function') {
    callback = port;
    port = 6881;
    stats = {};
  } else if (typeof stats === 'function') {
    callback = stats;
    stats = {};
  }

  if (typeof callback !== 'function') {
    throw new Error('tracker.getPeers() requires a callback function');
  }

  const announceUrl = torrent.announce.toString('utf8');
  if (announceUrl.startsWith('udp://')) {
    getPeersUDP(torrent, port, stats, callback);
  } else if (announceUrl.startsWith('http://') || announceUrl.startsWith('https://')) {
    getPeersHTTP(torrent, port, stats, callback);
  } else {
    throw new Error(`Unsupported tracker protocol: ${announceUrl}`);
  }
};

function getPeersUDP(torrent, port, stats, callback) {
  const socket = dgram.createSocket('udp4');
  const url = torrent.announce.toString('utf8');

  udpSend(socket, buildConnReq(), url, (err, res) => {
    if (err) return console.error(err);
    if (respType(res) === 'connect') {
      const connResp = parseConnResp(res);
      const announceReq = buildAnnounceReq(connResp.connectionId, torrent, port, stats);
      udpSend(socket, announceReq, url, (err, res) => {
        if (err) return console.error(err);
        if (respType(res) === 'announce') {
          const announceResp = parseAnnounceResp(res);
          callback(announceResp.peers);
        }
      });
    }
  });
}

function udpSend(socket, message, rawUrl, callback = () => {}, retries = 3, timeout = 5000) {
  const url = urlParse(rawUrl);
  const port = url.port || 6969;
  let attempts = 0;
  let timer;

  function trySend() {
    if (attempts >= retries) {
      clearTimeout(timer);
      return callback(new Error('UDP tracker did not respond'));
    }
    attempts++;
    socket.send(message, 0, message.length, port, url.hostname, err => {
      if (err) return callback(err);
      timer = setTimeout(trySend, timeout * attempts);
    });
  }

  socket.once('message', msg => {
    clearTimeout(timer);
    callback(null, msg);
  });

  trySend();
}

function respType(resp) {
  const action = resp.readUInt32BE(0);
  if (action === 0) return 'connect';
  if (action === 1) return 'announce';
}

function buildConnReq() {
  const buf = Buffer.allocUnsafe(16);
  buf.writeUInt32BE(0x417, 0);
  buf.writeUInt32BE(0x27101980, 4);
  buf.writeUInt32BE(0, 8);
  crypto.randomBytes(4).copy(buf, 12);
  return buf;
}

function parseConnResp(resp) {
  return {
    action: resp.readUInt32BE(0),
    transactionId: resp.readUInt32BE(4),
    connectionId: resp.slice(8)
  };
}

function buildAnnounceReq(connId, torrent, port, stats) {
  const buf = Buffer.allocUnsafe(98);
  connId.copy(buf, 0);
  buf.writeUInt32BE(1, 8);
  crypto.randomBytes(4).copy(buf, 12);
  torrentParser.infoHash(torrent).copy(buf, 16);
  util.genId().copy(buf, 36);

  const downloaded = Buffer.alloc(8);
  const left = Buffer.alloc(8);
  const uploaded = Buffer.alloc(8);

  (stats.downloaded || 0n).toString(16);  
  downloaded.writeBigUInt64BE(BigInt(stats.downloaded || 0), 0);
  left.writeBigUInt64BE(BigInt(stats.left || torrentParser.size(torrent).readBigUInt64BE()), 0);
  uploaded.writeBigUInt64BE(BigInt(stats.uploaded || 0), 0);

  downloaded.copy(buf, 56);
  left.copy(buf, 64);
  uploaded.copy(buf, 72);

  buf.writeUInt32BE(0, 80);  
  buf.writeUInt32BE(0, 84);  
  crypto.randomBytes(4).copy(buf, 88);  
  buf.writeInt32BE(-1, 92);  
  buf.writeUInt16BE(port, 96);  
  return buf;
}

function parseAnnounceResp(resp) {
  function group(iterable, groupSize) {
    let groups = [];
    for (let i = 0; i < iterable.length; i += groupSize) {
      groups.push(iterable.slice(i, i + groupSize));
    }
    return groups;
  }

  return {
    action: resp.readUInt32BE(0),
    transactionId: resp.readUInt32BE(4),
    leechers: resp.readUInt32BE(8),
    seeders: resp.readUInt32BE(12),
    peers: group(resp.slice(20), 6).map(address => ({
      ip: `${address[0]}.${address[1]}.${address[2]}.${address[3]}`,
      port: address.readUInt16BE(4)
    }))
  };
}
 
function getPeersHTTP(torrent, port, stats, callback) {
  const announceUrl = torrent.announce.toString('utf8');
  const url = urlParse(announceUrl);

  const infoHash = torrentParser.infoHash(torrent);
  const peerId = util.genId();
  const left = stats.left || torrentParser.size(torrent).readBigUInt64BE();

  function percentEncode(buffer) {
    let str = '';
    for (let i = 0; i < buffer.length; i++) {
      const ch = buffer[i];
      if (
        (ch >= 0x30 && ch <= 0x39) ||  
        (ch >= 0x41 && ch <= 0x5A) ||  
        (ch >= 0x61 && ch <= 0x7A) ||  
        ch === 0x2D || ch === 0x2E || ch === 0x5F || ch === 0x7E
      ) {
        str += String.fromCharCode(ch);
      } else {
        str += '%' + ch.toString(16).toUpperCase().padStart(2, '0');
      }
    }
    return str;
  }

  const query = {
    info_hash: percentEncode(infoHash),
    peer_id: percentEncode(peerId),
    port,
    uploaded: stats.uploaded || 0,
    downloaded: stats.downloaded || 0,
    left: left.toString(),
    compact: 1,
    event: 'started'
  };

  const queryStr = Object.entries(query)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const protocol = url.protocol === 'https:' ? https : http;
  protocol.get(`${announceUrl}?${queryStr}`, res => {
    let data = [];
    res.on('data', chunk => data.push(chunk));
    res.on('end', () => {
      try {
        const response = bencode.decode(Buffer.concat(data));
        const peers = parsePeers(response.peers);
        callback(peers);
      } catch (e) {
        console.error('Failed to decode tracker response:', e);
      }
    });
  }).on('error', err => {
    console.error('Tracker request error:', err);
  });
}

function parsePeers(peersBuffer) {
  let peers = [];
  for (let i = 0; i < peersBuffer.length; i += 6) {
    peers.push({
      ip: `${peersBuffer[i]}.${peersBuffer[i + 1]}.${peersBuffer[i + 2]}.${peersBuffer[i + 3]}`,
      port: peersBuffer.readUInt16BE(i + 4)
    });
  }
  return peers;
}
