'use strict';

class PieceAvailability {
  constructor(torrent) {
    this._availability = new Array(torrent.info.pieces.length).fill(0);
  }

  addPeerPieces(bitfield) {
    bitfield.forEach((byte, i) => {
      for (let j = 0; j < 8; j++) {
        if ((byte >> (7 - j)) & 1) {
          const pieceIndex = i * 8 + j;
          if (pieceIndex < this._availability.length) {
            this._availability[pieceIndex]++;
          }
        }
      }
    });
  }

  increment(pieceIndex) {
    this._availability[pieceIndex]++;
  }

  count(pieceBlock) {
    return this._availability[pieceBlock.index] || 0;
  }
}

module.exports = PieceAvailability;
