'use strict';

const net = require('net');
const message = require('./message');
const torrentParser = require('./torrent-parser');
const fs = require('fs');

/**
 * Start seeding the given torrent.
 * @param {Object} torrent Parsed torrent object
 * @param {String} filePath Path to the complete file on disk
 */
module.exports = function startSeeding(torrent, filePath) {
  const server = net.createServer(socket => {
    console.log('Peer connected for seeding:', socket.remoteAddress, socket.remotePort);

    socket.write(message.buildHandshake(torrent));

    socket.on('data', data => {
      const msg = message.parse(data);

      if (msg.id === 6) { 
        const { index, begin, length } = msg.payload;
        const offset = index * torrent.info['piece length'] + begin;
        const block = Buffer.alloc(length);

        fs.open(filePath, 'r', (err, fd) => {
          if (err) return console.error('File open error:', err);

          fs.read(fd, block, 0, length, offset, (err) => {
            fs.close(fd, () => {});
            if (err) return console.error('File read error:', err);
            socket.write(message.buildPiece(index, begin, block));
          });
        });
      }
    });
  });

  server.listen(6881, () => {
    console.log('Seeding server listening on port 6881...');
  });
};
