// ============================================================
// PhotonBoard — Art-Net 4 ArtDmx packet encoding (pure logic)
// Spec: https://art-net.org.uk — OpDmx (0x5000), protocol 14.
// ============================================================

export const ARTNET_PORT = 6454
const ARTNET_ID = Buffer.from('Art-Net\0', 'ascii')
const OP_DMX = 0x5000
const PROTOCOL_VERSION = 14
const HEADER_SIZE = 18

/** 15-bit Port-Address: Net (7 bits) · Sub-Net (4 bits) · Universe (4 bits) */
export function artnetPortAddress(net: number, subnet: number, universe: number): number {
  return ((net & 0x7f) << 8) | ((subnet & 0x0f) << 4) | (universe & 0x0f)
}

/** Next ArtDmx sequence number: 1..255 (0 means "sequencing disabled") */
export function nextSequence(seq: number): number {
  return seq >= 255 ? 1 : seq + 1
}

/**
 * Build an ArtDmx packet. `data` is the 512-slot universe buffer; the
 * payload length is always even and between 2 and 512 as the spec requires.
 */
export function buildArtDmxPacket(
  sequence: number,
  net: number,
  subnet: number,
  universe: number,
  data: Uint8Array
): Buffer {
  let length = Math.min(512, Math.max(2, data.length))
  if (length % 2 === 1) length++
  const packet = Buffer.alloc(HEADER_SIZE + length)
  ARTNET_ID.copy(packet, 0)
  packet.writeUInt16LE(OP_DMX, 8)              // OpCode, little-endian
  packet.writeUInt16BE(PROTOCOL_VERSION, 10)   // ProtVerHi, ProtVerLo
  packet[12] = sequence & 0xff
  packet[13] = 0                               // Physical input port (informational)
  const portAddress = artnetPortAddress(net, subnet, universe)
  packet[14] = portAddress & 0xff              // SubUni
  packet[15] = (portAddress >> 8) & 0x7f       // Net
  packet.writeUInt16BE(length, 16)             // Length, big-endian
  packet.set(data.subarray(0, Math.min(length, data.length)), HEADER_SIZE)
  return packet
}
