# TORRENT CLIENT 

A fully functional Torrent client built in **Node.js** supporting peer-to-peer file sharing, tracker communication, and piece-wise downloading.

---

## Features

- **Torrent File Parsing:** Parses `.torrent` files to extract metadata, trackers, and file information.  
- **UDP Tracker Protocol:** Implements connect and announce workflows to fetch peer addresses efficiently.  
- **P2P Networking:** Built a robust layer using TCP sockets, supporting Torrent handshake, choke/unchoke, requests, and data exchange.  
- **Piece–Block Management:** Tracks requested and received blocks, optimizing download coordination.  
- **File Reconstruction & Progress Tracking:** Reconstructs files by writing blocks at correct offsets and provides real-time download progress.

---
