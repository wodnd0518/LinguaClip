/**
 * 확장 프로그램 빌드 후처리:
 * 1. content.ts, background.ts → esbuild로 번들링
 * 2. manifest.json 복사
 * 3. 아이콘 PNG 생성 (인디고 #6366f1)
 */

import { build } from 'esbuild'
import { copyFileSync, mkdirSync, writeFileSync } from 'fs'
import { deflateSync } from 'zlib'

// ── PNG 생성 ──────────────────────────────────────────────
function crc32(buf) {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const len = Buffer.allocUnsafe(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.allocUnsafe(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0)
  return Buffer.concat([len, typeBytes, data, crc])
}

function createPNG(size, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.allocUnsafe(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.writeUInt8(8, 8)  // bit depth
  ihdr.writeUInt8(2, 9)  // RGB
  ihdr.writeUInt8(0, 10); ihdr.writeUInt8(0, 11); ihdr.writeUInt8(0, 12)

  const rowLen = 1 + size * 3
  const raw = Buffer.alloc(size * rowLen)
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0 // filter: None
    for (let x = 0; x < size; x++) {
      raw[y * rowLen + 1 + x * 3] = r
      raw[y * rowLen + 1 + x * 3 + 1] = g
      raw[y * rowLen + 1 + x * 3 + 2] = b
    }
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ── 실행 ─────────────────────────────────────────────────
mkdirSync('dist-ext/icons', { recursive: true })

// 아이콘 생성 (인디고 #6366f1 = RGB 99,102,241)
for (const size of [16, 48, 128]) {
  writeFileSync(`dist-ext/icons/icon${size}.png`, createPNG(size, 99, 102, 241))
  console.log(`✓ icons/icon${size}.png`)
}

// manifest.json 복사
copyFileSync('manifest.json', 'dist-ext/manifest.json')
console.log('✓ manifest.json')

// content.js, background.js 빌드 (IIFE — 모듈 구문 없는 단일 파일)
await build({
  entryPoints: {
    content: 'src/extension/content.ts',
    background: 'src/extension/background.ts',
  },
  bundle: true,
  format: 'iife',
  outdir: 'dist-ext',
  treeShaking: true,
})
console.log('✓ content.js, background.js')

console.log('\n🎉 확장 프로그램 빌드 완료 → dist-ext/')
console.log('   Chrome: 확장 프로그램 → 압축해제된 확장 프로그램 로드 → dist-ext 폴더 선택')
