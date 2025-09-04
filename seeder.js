'use strict';

const torrentParser = require('./src/torrent-parser');
const download = require('./src/download');

const torrent = torrentParser.open(process.argv[2]);

console.log('Seeder running for torrent:', torrent.info.name.toString('utf8'));
console.log("Info Hash:", torrentParser.infoHash(torrent).toString('hex'));
console.log("Total Size:", torrentParser.size(torrent).readBigUInt64BE(), "bytes");

download(torrent, torrent.info.name, { seedOnly: true, port: 6881 });
