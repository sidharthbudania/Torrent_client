

'use strict';

const torrentParser = require('./src/torrent-parser');
const download = require('./src/download');
const torrent = torrentParser.open(process.argv[2]);

console.log("Tracker URL:", torrent.announce.toString('utf8'));
console.log("Torrent Name:", torrent.info.name);
console.log("Info Hash:", torrentParser.infoHash(torrent).toString('hex'));

const sizeBytes = torrentParser.size(torrent);
console.log("Total Size:", sizeBytes, "bytes");



