'use strict';

const fs = require('fs');
const net = require('net');
const tracker = require('./tracker');
const message = require('./message');
const Pieces = require('./Pieces');
const Queue = require('./Queue');
const pieceAvailability = require('./pieceAvailability');
const torrentParser = require('./torrent-parser');

module.exports = (torrent, filePath) => {
  tracker.getPeers(torrent, 6881, { uploaded: 0, downloaded: 0, left: torrentParser.size(torrent) }, peers => {
    console.log('Received', peers.length, 'peers from tracker.');
    const pieces = new Pieces(torrent, filePath);
    const file = fs.openSync(filePath, 'w');
    const pieceAvailabilityInstance = new pieceAvailability(torrent);
    peers.forEach(peer => download(peer, torrent, pieces, file, pieceAvailabilityInstance));
  });
};

function download(peer, torrent, pieces, file, pieceAvailability) {

  const socket = new net.Socket();
  socket.on('error', console.log);
  socket.connect(peer.port, peer.ip, () => {
    console.log(`Connected to peer ${peer.ip}:${peer.port} for downloading`);
    socket.write(message.buildHandshake(torrent));
  });

  const queue = new Queue(torrent);
  onWholeMsg(socket, msg => msgHandler(msg, socket, pieces, queue, torrent, file, pieceAvailability));
}


function onWholeMsg(socket, callback) {
  let savedBuf = Buffer.alloc(0);
  let handshake = true;

  socket.on('data', recvBuf => {
    const msgLen = () => handshake ? savedBuf.readUInt8(0) + 49 : savedBuf.readInt32BE(0) + 4;
    savedBuf = Buffer.concat([savedBuf, recvBuf]);

    while (savedBuf.length >= 4 && savedBuf.length >= msgLen()) {
      callback(savedBuf.slice(0, msgLen()));
      savedBuf = savedBuf.slice(msgLen());
      handshake = false;
    }
  });
}

function msgHandler(msg, socket, pieces, queue, torrent, file, pieceAvailability) {
  if (isHandshake(msg)) {
    socket.write(message.buildInterested());
  } else {
    const m = message.parse(msg);

    if (m.id === 0) chokeHandler(socket);
    if (m.id === 1) unchokeHandler(socket, pieces, queue, pieceAvailability);
    if (m.id === 4) haveHandler(socket, pieces, queue, m.payload, pieceAvailability);
    if (m.id === 5) bitfieldHandler(socket, pieces, queue, m.payload, pieceAvailability);
    if (m.id === 7) pieceHandler(socket, pieces, queue, torrent, file, m.payload, pieceAvailability);
  }
}

function isHandshake(msg) {
  return msg.length === msg.readUInt8(0) + 49 &&
         msg.toString('utf8', 1, 20) === 'BitTorrent protocol';
}

function chokeHandler(socket) {
  socket.end();
}

function unchokeHandler(socket, pieces, queue, pieceAvailability) {
  queue.choked = false;
  requestPiece(socket, pieces, queue, pieceAvailability);
}

function haveHandler(socket, pieces, queue, payload, pieceAvailability) {
  const pieceIndex = payload.readUInt32BE(0);
 
  pieceAvailability.increment(pieceIndex);

  const queueEmpty = queue.length() === 0;
  queue.queue(pieceIndex);
  if (queueEmpty) requestPiece(socket, pieces, queue, pieceAvailability);
}

function bitfieldHandler(socket, pieces, queue, payload, pieceAvailability) {
  const queueEmpty = queue.length() === 0;
  pieceAvailability.addPeerPieces(payload);

  payload.forEach((byte, i) => {
    for (let j = 0; j < 8; j++) {
      if ((byte >> (7 - j)) & 1) {
        const pieceIndex = i * 8 + j;
        queue.queue(pieceIndex);
        pieceAvailability.increment(pieceIndex);
      }
    }
  });

  if (queueEmpty) requestPiece(socket, pieces, queue, pieceAvailability);
}

function pieceHandler(socket, pieces, queue, torrent, file, pieceResp, pieceAvailability) {
  pieces.printPercentDone();

  pieces.addReceived(pieceResp);

  const offset = pieceResp.index * torrent.info['piece length'] + pieceResp.begin;
  fs.write(file, pieceResp.block, 0, pieceResp.block.length, offset, () => {});

  if (pieces.isDone()) {
    console.log('DONE!');
    socket.end();
    try { fs.closeSync(file); } catch(e) {}
  } else {
    requestPiece(socket, pieces, queue, pieceAvailability);
  }
}

function requestPiece(socket, pieces, queue, pieceAvailability) {
  if (queue.choked) return null;

  const allQueued = queue.getAll();
  const sorted = allQueued.sort((a, b) => {
    return pieceAvailability.count(a) - pieceAvailability.count(b);
  });

  for (const pieceBlock of sorted) {
    if (pieces.needed(pieceBlock)) {
      queue.remove(pieceBlock);
      if (!socket.destroyed && socket.writable) {
        socket.write(message.buildRequest(pieceBlock));
        pieces.addRequested(pieceBlock);
      } else {
        console.warn('Socket not writable or destroyed, skipping write.');
      }
      break;
    } else {
      queue.remove(pieceBlock);
    }
  }
}



// function startSeeding(torrent, pieces) {
//   const server = net.createServer();
//   const peers = new Map();
//   setInterval(() => {
//     const interestedPeers = Array.from(peers.values()).filter(p => p.interested);
//     const peersToUnchoke = interestedPeers.sort(() => 0.5 - Math.random()).slice(0, 4);
//     peers.forEach((peer, peerId) => {
//       if (peersToUnchoke.find(p => p.socket === peer.socket)) {
//         if (peer.choked) {
//           peer.choked = false;
//           peer.socket.write(message.buildUnchoke());
//           console.log(`Unchoked ${peerId}`);
//         }
//       } else {
//         if (!peer.choked) {
//           peer.choked = true;
//           peer.socket.write(message.buildChoke());
//           console.log(`Choked ${peerId}`);
//         }
//       }
//     });
//   }, 10000); 

//   server.on('connection', socket => {
//     const peerId = `${socket.remoteAddress}:${socket.remotePort}`;
//     console.log(`Peer connected for seeding: ${peerId}`);

//     const peerState = {
//       socket: socket,
//       isHandshake: true,
//       choked: true,
//       interested: false,
//       uploaded: 0
//     };
//     peers.set(peerId, peerState);

//     onWholeMsg(socket, msg => seedMsgHandler(msg, peerId, pieces, torrent, peers));

//     socket.on('close', () => {
//       console.log(`Peer disconnected: ${peerId}`);
//       peers.delete(peerId);
//     });

//     socket.on('error', (err) => {
//       console.log(`Error with peer ${peerId}: ${err.message}`);
//       socket.destroy();
//       peers.delete(peerId);
//     });
//   });

//   server.listen(torrent.info.port || 6881, () => {
//     console.log(`Seeding server listening on port ${server.address().port}`);
//   });
// }

// function seedMsgHandler(msg, peerId, pieces, torrent, peers) {
//   const peer = peers.get(peerId);

//   if (peer.isHandshake) {
//     if (msg.length !== msg.readUInt8(0) + 49 || msg.toString('utf8', 1, 20) !== 'BitTorrent protocol') {
//       console.log(`[${peerId}] Invalid handshake message format. Dropping connection.`);
//       peer.socket.destroy();
//       return;
//     }

//     const receivedHash = msg.slice(28, 48);

//     const torrentHash = torrentParser.infoHash(torrent);

//     if (!receivedHash.equals(torrentHash)) {
//       console.log(`[${peerId}] Handshake failed: Info hash does not match for torrent "${torrent.info.name.toString('utf8')}".`);
//       peer.socket.destroy();
//       return;
//     }

//     console.log(`[${peerId}] Handshake successful.`);
//     peer.isHandshake = false;
    
//     peer.socket.write(message.buildHandshake(torrent));
//     peer.socket.write(message.buildBitfield(pieces.getBitfield()));
    
//     return;
//   }

//   const m = message.parse(msg);

//   if (m.id === 2) { 
//     console.log(`[${peerId}] is interested.`);
//     peer.interested = true;
//   }
//   if (m.id === 3) { 
//     console.log(`[${peerId}] is not interested.`);
//     peer.interested = false;
//   }
//   if (m.id === 6) {
//     sendPieceBlock(peer, pieces, m.payload);
//   }
// }

// function sendPieceBlock(peer, pieces, payload) {
//   const pieceIndex = payload.readUInt32BE(0);
//   const begin = payload.readUInt32BE(4);
//   const length = payload.readUInt32BE(8);

//   if (peer.choked) {
//     console.log(`Ignoring request from choked peer ${peer.socket.remoteAddress}`);
//     return;
//   }
//   if (length > 16384) {
//     console.log(`Peer ${peer.socket.remoteAddress} requested oversized block. Dropping.`);
//     peer.socket.destroy();
//     return;
//   }

//   const block = pieces.getBlock(pieceIndex, begin, length);

//   if (block) {
//     peer.socket.write(message.buildPiece({ index: pieceIndex, begin: begin, block: block }));
//     peer.uploaded += length;
//   } else {
//     console.log(`Could not get block for piece ${pieceIndex} from storage.`);
//   }
// }

