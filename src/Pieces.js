

'use strict';

const tp = require('./torrent-parser');
const fs = require('fs');

module.exports = class Pieces {
  constructor(torrent, filePath) {
    this._torrent = torrent;
    this._filePath = filePath;
 
    const buildPiecesArray = () => {
      const nPieces = torrent.info.pieces.length / 20;
      return Array.from({ length: nPieces }, (_, i) => {
        const nBlocks = tp.blocksPerPiece(torrent, i) || 0; 
        return new Array(nBlocks).fill(false);
      });
    };

    this._requested = buildPiecesArray();
    this._received = buildPiecesArray();
  }

  addRequested(pieceBlock) {
    const blockIndex = pieceBlock.begin / tp.BLOCK_LEN;
    if (this._requested[pieceBlock.index])
      this._requested[pieceBlock.index][blockIndex] = true;
  }

  addReceived(pieceBlock) {
    const blockIndex = pieceBlock.begin / tp.BLOCK_LEN;
    if (this._received[pieceBlock.index])
      this._received[pieceBlock.index][blockIndex] = true;
  }

  needed(pieceBlock) {
    if (this._requested.every(blocks => blocks.every(Boolean))) { 
      this._requested = this._received.map(blocks => blocks.slice());
    }
    const blockIndex = pieceBlock.begin / tp.BLOCK_LEN;
    return !this._requested[pieceBlock.index][blockIndex];
  }

  isDone() {
    return this._received.every(blocks => blocks.every(Boolean));
  }

  printPercentDone() {
  const downloaded = this._received.reduce(
    (total, blocks) => total + blocks.filter(Boolean).length,
    0
  );
  const total = this._received.reduce((total, blocks) => total + blocks.length, 0);
  const percent = ((downloaded / total) * 100).toFixed(2);

  process.stdout.write(`\rProgress: ${percent}% (${downloaded}/${total} blocks)`);

  if (downloaded === total) {
    process.stdout.write('\n');  
  }
}


  markAllAsReceived() {
    this._received = this._received.map(blocks => blocks.map(() => true));
    this._requested = this._received.map(blocks => blocks.slice());
  }

  getBitfield() {
    const bitfieldLength = Math.ceil(this._received.length / 8);
    const bitfield = Buffer.alloc(bitfieldLength, 0);

    this._received.forEach((blocks, pieceIndex) => {
      if (blocks.every(Boolean)) {
        const byteIndex = Math.floor(pieceIndex / 8);
        const bitIndex = 7 - (pieceIndex % 8);
        bitfield[byteIndex] |= 1 << bitIndex;
      }
    });

    return bitfield;
  }

  hasPiece(pieceIndex) {
    if (pieceIndex < 0 || pieceIndex >= this._received.length) return false;
    return this._received[pieceIndex].every(Boolean);
  }

  getBlock(pieceIndex, begin, length) {
    return new Promise((resolve, reject) => {
      const pieceLength = this._torrent.info['piece length'];
      const offset = pieceIndex * pieceLength + begin;
      const buffer = Buffer.alloc(length);

      fs.open(this._filePath, 'r', (err, fd) => {
        if (err) return reject(err);

        fs.read(fd, buffer, 0, length, offset, (err, bytesRead) => {
          fs.close(fd, () => {});
          if (err) return reject(err);
          resolve(buffer.slice(0, bytesRead));
        });
      });
    });
  }

  nextNeededBlock(pieceIndex) {
    if (pieceIndex < 0 || pieceIndex >= this._received.length) return null;

    const blocks = this._received[pieceIndex];
    if (!blocks) return null;  

    const pieceLengthStandard = this._torrent.info['piece length'];
    const totalSize =
      this._torrent.info.length ||
      this._torrent.info.files.reduce((acc, f) => acc + f.length, 0);
    const lastPieceIndex = this._received.length - 1;

    const pieceLength =
      pieceIndex === lastPieceIndex
        ? totalSize - pieceLengthStandard * lastPieceIndex
        : pieceLengthStandard;

    for (let i = 0; i < blocks.length; i++) {
      if (!this._requested[pieceIndex][i]) {
        this._requested[pieceIndex][i] = true;

        const begin = i * tp.BLOCK_LEN;
        const length = Math.min(tp.BLOCK_LEN, pieceLength - begin);

        return { index: pieceIndex, begin, length };
      }
    }

    return null;
  }
};
