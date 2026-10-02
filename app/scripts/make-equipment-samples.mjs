// 生成装备面板合成样本（用于回归覆盖“全屏截图”与“缩放截图”两种真实场景）
// 用法：node scripts/make-equipment-samples.mjs [--out <目录>]
// 说明：
//   · fullscreen-1x.png：1920x1080 桌面（任务栏 + 图标块 + 窗口块 + 右下角缩放干扰面板）+ 面罩面板 1x
//   · zoom-1.5x.png    ：面板 1.5 倍放大（模拟 Windows 150% 显示缩放下的截图）
//   两张图的词条真值与 装备_头部_面罩.png 相同（见 truth.json）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const PROJECT_DIR = path.resolve(APP_DIR, '..')
const SAMPLES_DIR = path.join(PROJECT_DIR, '文档', 'ocr_samples', 'equipment')

const parseArgs = (argv) => {
  const options = { out: path.join(SAMPLES_DIR, 'synthetic') }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') options.out = argv[++index]
  }
  return options
}

const readPng = (file) => {
  const png = PNG.sync.read(readFileSync(file))
  return { data: png.data, width: png.width, height: png.height }
}

const createCanvas = (width, height, rgb) => {
  const png = new PNG({ width, height })
  for (let index = 0; index < width * height; index += 1) {
    png.data[index * 4] = rgb[0]
    png.data[index * 4 + 1] = rgb[1]
    png.data[index * 4 + 2] = rgb[2]
    png.data[index * 4 + 3] = 255
  }
  return png
}

const fillRect = (canvas, x0, y0, width, height, rgb) => {
  for (let y = y0; y < y0 + height && y < canvas.height; y += 1) {
    if (y < 0) continue
    for (let x = x0; x < x0 + width && x < canvas.width; x += 1) {
      if (x < 0) continue
      const index = (y * canvas.width + x) * 4
      canvas.data[index] = rgb[0]
      canvas.data[index + 1] = rgb[1]
      canvas.data[index + 2] = rgb[2]
      canvas.data[index + 3] = 255
    }
  }
}

/** 把面板按 scale 最近邻贴到画布 (x0, y0) */
const blit = (canvas, panel, scale, x0, y0) => {
  const width = Math.round(panel.width * scale)
  const height = Math.round(panel.height * scale)
  for (let y = 0; y < height; y += 1) {
    const targetY = y0 + y
    if (targetY < 0 || targetY >= canvas.height) continue
    const sourceY = Math.min(panel.height - 1, Math.floor(y / scale))
    for (let x = 0; x < width; x += 1) {
      const targetX = x0 + x
      if (targetX < 0 || targetX >= canvas.width) continue
      const sourceX = Math.min(panel.width - 1, Math.floor(x / scale))
      const source = (sourceY * panel.width + sourceX) * 4
      const target = (targetY * canvas.width + targetX) * 4
      canvas.data[target] = panel.data[source]
      canvas.data[target + 1] = panel.data[source + 1]
      canvas.data[target + 2] = panel.data[source + 2]
      canvas.data[target + 3] = 255
    }
  }
}

const main = () => {
  const options = parseArgs(process.argv.slice(2))
  mkdirSync(options.out, { recursive: true })
  const panel = readPng(path.join(SAMPLES_DIR, '装备_头部_面罩.png'))
  const other = readPng(path.join(SAMPLES_DIR, '装备_腿部_靴子.png'))

  // A：1920x1080 桌面全屏截图（面板 1x + 干扰）
  const full = createCanvas(1920, 1080, [56, 60, 68])
  fillRect(full, 0, 0, 1920, 40, [32, 34, 38])            // 顶部任务栏
  fillRect(full, 40, 120, 90, 90, [74, 79, 90])           // 桌面图标块
  fillRect(full, 40, 240, 90, 90, [88, 82, 74])
  fillRect(full, 1560, 300, 320, 220, [66, 70, 78])       // 桌面窗口
  blit(full, other, 0.35, 1600, 560)                      // 右下角“另一个截图窗口”（缩放干扰）
  blit(full, panel, 1, 683, 90)
  writeFileSync(path.join(options.out, 'fullscreen-1x.png'), PNG.sync.write(full))
  console.log('已生成 fullscreen-1x.png（1920x1080，面板 1x + 干扰）')

  // B：面板放大 1.5 倍（模拟 Windows 150% 缩放）
  const zoom = createCanvas(1600, 1420, [56, 60, 68])
  blit(zoom, panel, 1.5, 384, 20)
  writeFileSync(path.join(options.out, 'zoom-1.5x.png'), PNG.sync.write(zoom))
  console.log('已生成 zoom-1.5x.png（面板 1.5x）')
  console.log(`输出目录：${path.relative(PROJECT_DIR, options.out)}`)
}

main()