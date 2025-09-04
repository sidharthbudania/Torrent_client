'use strict';

const fs = require('fs');
const bencode = require('bencode');
const crypto = require('crypto');

module.exports.BLOCK_LEN = Math.pow(2, 14);

module.exports.open = (filepath) => {
  return bencode.decode(fs.readFileSync(filepath));
};

module.exports.infoHash = torrent => {
  const info = bencode.encode(torrent.info);
  return crypto.createHash('sha1').update(info).digest();
};

module.exports.size = torrent => {
  const size = torrent.info.files ?
    torrent.info.files.map(file => BigInt(file.length)).reduce((a, b) => a + b) :
    BigInt(torrent.info.length);

  return size; 
};

module.exports.pieceLen = (torrent, pieceIndex) => {
  const totalLength = this.size(torrent);
  const pieceLength = BigInt(torrent.info['piece length']);

  const lastPieceLength = totalLength % pieceLength;
  const lastPieceIndex = totalLength / pieceLength;

  if (BigInt(pieceIndex) === lastPieceIndex) {
    return Number(lastPieceLength);
  }
  
  return Number(pieceLength);
};


module.exports.blocksPerPiece = (torrent, pieceIndex) => {
  const pieceLength = this.pieceLen(torrent, pieceIndex);
  return Math.ceil(pieceLength / this.BLOCK_LEN);
};

module.exports.blockLen = (torrent, pieceIndex, blockIndex) => {
  const pieceLength = this.pieceLen(torrent, pieceIndex);

  const lastPieceLength = pieceLength % this.BLOCK_LEN;
  const lastPieceIndex = Math.floor(pieceLength / this.BLOCK_LEN);

  return blockIndex === lastPieceIndex ? lastPieceLength : this.BLOCK_LEN;
};