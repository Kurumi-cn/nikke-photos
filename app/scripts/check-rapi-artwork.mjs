import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import roster from '../src/data/roster.json' with { type: 'json' }

const rapi = roster.characters.find(character => character.nameCode === '3001')
for (const [id, label, file] of [
  ['skin-2', '白色诺言', 'c010_01.webp'],
  ['skin-3', '经典假期', 'c010_02.webp'],
]) {
  test(`拉毗已保存的 ${id} 显示${label}立绘`, () => {
    const artwork = rapi.artworks.find(item => item.id === id)
    assert.deepEqual(artwork, { id, label, file })
    const image = readFileSync(new URL('../public/ui-assets/nikke/character-artwork/' + file, import.meta.url))
    assert.equal(image.toString('ascii', 8, 12), 'WEBP')
  })
}
