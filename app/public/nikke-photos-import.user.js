// ==UserScript==
// @name         NIKKE Photos · BlaBlaLink 账号数据导出
// @namespace    https://github.com/Kurumi-cn/nikke-photos
// @version      1.0.0
// @description  在 BlaBlaLink 页面上一键读取你账号里的妮姬数据（等级/突破/好感度/技能/魔方/收藏品/四件装备词条），导出成 JSON，拖进 NIKKE Photos 即可自动建档。数据只在本机处理，不会上传到任何服务器。
// @author       Kurumi-cn
// @match        https://www.blablalink.com/*
// @connect      api.blablalink.com
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @run-at       document-idle
// @noframes
// @downloadURL  https://kurumi-cn.github.io/nikke-photos/nikke-photos-import.user.js
// @updateURL    https://kurumi-cn.github.io/nikke-photos/nikke-photos-import.user.js
// ==/UserScript==

/*
 * ============================ 使用前请读完 ============================
 *
 * 这个脚本做什么？
 *   在你已经登录 BlaBlaLink 的浏览器里，向官方接口读取**你自己账号**的妮姬数据，
 *   并且将数据整理成一个 JSON 文件下载到本地。若不放心此文件的安全性，请喂给AI查阅。
 *
 * 数据去哪了
 *   只在你的浏览器内存里 → 直接下载到你的磁盘。**不会上传到任何第三方服务器**，
 *   本项目没有任何服务端。导出的 JSON 里只有一些游戏数据，
 *   **不含 Cookie / token / openid 等身份信息**（字段是白名单逐项挑出来的）。
 *
 * 风险提示！！！！！！
 *   依照 NIKKE 官方服务条款，未经授权用第三方程序采集游戏数据存在风险；
 *   本脚本不做后台定时、不做并发、不做逐角色循环，只在你点按钮时串行请求一次，
 *   但能否使用、后果如何，请由你自己判断并承担！
 *
 * =====================================================================
 */

(function () {
  'use strict'

  // 这行是给排查用的：只要脚本跑了，页面控制台一定先看到它。
  // 如果控制台里连他都没有，说明问题在油猴的匹配/启用，而不是脚本本身。
  console.log('[NIKKE Photos] 脚本已加载，等待页面就绪…')

  const PANEL_ID = 'nkp-import-panel'
  const API_BASE = 'https://api.blablalink.com'
  const ENDPOINTS = {
    playerInfo: `${API_BASE}/api/ugc/direct/standalonesite/User/GetUserGamePlayerInfo`,
    basicInfo: `${API_BASE}/api/game/proxy/Game/GetUserProfileBasicInfo`,
    outpostInfo: `${API_BASE}/api/game/proxy/Game/GetUserProfileOutpostInfo`,
    characters: `${API_BASE}/api/game/proxy/Game/GetUserCharacters`,
    characterDetails: `${API_BASE}/api/game/proxy/Game/GetUserCharacterDetails`,
  }
  const SLOTS = ['head', 'torso', 'arm', 'leg']
  const EXPORT_FORMAT = 'nikke-photos-account'
  const EXPORT_VERSION = 1
  /** 这个业务码表示玩家信息临时不可用，官方服务端自己也会抖，值得等一秒重试 */
  const PLAYER_INFO_RETRY_CODE = '1300015'
  const PLAYER_INFO_RETRY_DELAYS = [1000, 2000]

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  /** 读取页面能看到的 Cookie（httpOnly 的读不到，此时靠 GM_xmlhttpRequest 自带的 Cookie） */
  const readableCookie = () => {
    try {
      return String(document.cookie || '')
    } catch {
      return ''
    }
  }

  const readCookieValue = (name) => {
    const matched = readableCookie().match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
    return matched ? decodeURIComponent(matched[1]) : ''
  }

  /** 跑一次请求；非 2xx 抛带 status 的错误，方便上层区分限流/风控 */
  const request = (url, body) => new Promise((resolve, reject) => {
    const cookie = readableCookie()
    GM_xmlhttpRequest({
      method: 'POST',
      url,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      data: JSON.stringify(body || {}),
      // 默认就会带上浏览器里该域的 Cookie；这里再把页面可见的那部分合并进去，
      // 只是为了对非 httpOnly 的情况更稳一点，两边的同名 Cookie 以这里为准。
      ...(cookie ? { cookie } : {}),
      timeout: 30000,
      onload: (response) => {
        if (response.status < 200 || response.status >= 300) {
          const error = new Error(`HTTP ${response.status}`)
          error.status = response.status
          reject(error)
          return
        }
        try {
          resolve(JSON.parse(response.responseText))
        } catch {
          reject(new Error('接口返回的不是合法 JSON'))
        }
      },
      onerror: () => reject(new Error('网络请求失败')),
      ontimeout: () => reject(new Error('请求超时')),
    })
  })

  const businessCode = (payload) => payload?.code ?? payload?.retcode ?? payload?.ret_code
  const isOk = (payload) => String(businessCode(payload)) === '0'

  const friendlyError = (error) => {
    if (error?.status === 429) return '被官方接口限流了（429）。这次不会自动重试，请过几分钟再试。'
    if (error?.status === 403) return '请求被拒绝（403）。可能是登录态失效，或者触发了风控，请稍后再试。'
    if (error?.status >= 500) return `官方接口出错了（${error.status}），稍后再试。`
    return error?.message || String(error)
  }

  /** 玩家信息带 1300015 时做一次有界重试（照抄 NIKKE Workshop 的恢复策略） */
  const fetchPlayerInfo = async () => {
    for (let attempt = 0; ; attempt += 1) {
      const payload = await request(ENDPOINTS.playerInfo, {})
      if (!isOk(payload) && String(businessCode(payload)) === PLAYER_INFO_RETRY_CODE
        && attempt < PLAYER_INFO_RETRY_DELAYS.length) {
        await sleep(PLAYER_INFO_RETRY_DELAYS[attempt])
        continue
      }
      return payload
    }
  }

  /**
   * 把一次详情响应整理成中间格式里的一条角色记录。
   * 这里**不做任何游戏业务映射**（不查魔方表、不推收藏品品质），
   * 只把接口字段搬成规整形状，真正的映射在本项目的 accountImport.js 里做。
   */
  const toCharacterEntry = (detail, effectsMap, missCounter) => {
    const number = (value, fallback = null) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
    const record = (field, value) => {
      if (value === null) missCounter[field] = (missCounter[field] || 0) + 1
      return value
    }

    const equipments = SLOTS.map((slot) => {
      const lines = []
      for (let position = 1; position <= 3; position += 1) {
        const optionId = detail?.[`${slot}_equip_option${position}_id`]
        if (!optionId) continue
        const effect = effectsMap.get(String(optionId))
        if (!Array.isArray(effect?.function_details)) continue
        effect.function_details.forEach((func) => {
          if (!func?.function_type) return
          lines.push({
            position,
            functionType: String(func.function_type),
            level: number(func.level),
            // 接口给的是"百分数 ×100"（11.81% → -1181，减益为负），取绝对值还原成 11.81
            value: Number.isFinite(Number(func.function_value)) ? Math.abs(Number(func.function_value)) / 100 : null,
          })
        })
      }
      return lines
    })

    return {
      nameCode: String(detail?.name_code ?? '').trim(),
      level: record('角色等级', number(detail?.lv)),
      grade: record('突破', number(detail?.grade)),
      core: record('核心', number(detail?.core)),
      combat: record('战斗力', number(detail?.combat)),
      affection: record('好感度', number(detail?.attractive_lv)),
      skills: {
        skill1: record('技能1', number(detail?.skill1_lv)),
        skill2: record('技能2', number(detail?.skill2_lv)),
        burst: record('爆裂技能', number(detail?.ulti_skill_lv)),
      },
      cube: {
        cubeId: number(detail?.harmony_cube_tid),
        level: record('魔方等级', number(detail?.harmony_cube_lv)),
      },
      favoriteItem: {
        tid: number(detail?.favorite_item_tid),
        level: record('收藏品等级', number(detail?.favorite_item_lv)),
      },
      equipments,
    }
  }

  /** 走完整个流程，返回要落盘的 JSON 对象 */
  const collectAccountData = async (onStep) => {
    onStep('检查登录态…')
    const playerInfo = await fetchPlayerInfo()
    if (!isOk(playerInfo)) {
      throw new Error(playerInfo?.msg
        ? `接口返回：${playerInfo.msg}（请确认已在 BlaBlaLink 登录）`
        : '拿不到玩家信息，请确认已在 BlaBlaLink 登录')
    }
    const areaId = String(playerInfo?.data?.area_id ?? '').trim()
    const roleName = String(playerInfo?.data?.role_name ?? '').trim()
    if (!areaId) throw new Error('接口没有返回区服编号（area_id），无法继续')

    const intlOpenId = readCookieValue('game_openid')

    onStep('读取昵称与区服…')
    const basicBody = { nikke_area_id: parseInt(areaId, 10) }
    if (intlOpenId) basicBody.intl_open_id = intlOpenId
    const basicInfo = await request(ENDPOINTS.basicInfo, basicBody).catch(() => null)
    const profileName = String(basicInfo?.data?.basic_info?.nickname || roleName || '').trim()

    onStep('读取前哨与研究所等级…')
    const outpostInfo = await request(ENDPOINTS.outpostInfo, { nikke_area_id: parseInt(areaId, 10) }).catch(() => null)
    const outpost = outpostInfo?.data?.outpost_info || {}
    const researches = (Array.isArray(outpost.recycle_room_researches) ? outpost.recycle_room_researches : [])
      .map((item) => ({ tid: Number(item?.tid), lv: Number(item?.lv) }))
      .filter((item) => Number.isFinite(item.tid))

    onStep('读取已拥有角色…')
    const charactersBody = { nikke_area_id: parseInt(areaId, 10) }
    if (intlOpenId) charactersBody.intl_open_id = intlOpenId
    const owned = await request(ENDPOINTS.characters, charactersBody)
    if (!isOk(owned)) throw new Error(owned?.msg ? `读取角色列表失败：${owned.msg}` : '读取角色列表失败')
    const nameCodes = [...new Set(
      (Array.isArray(owned?.data?.characters) ? owned.data.characters : [])
        .map((item) => String(item?.name_code ?? '').trim())
        .filter(Boolean),
    )]
    if (nameCodes.length === 0) throw new Error('这个账号里没有读到任何角色')

    onStep(`读取 ${nameCodes.length} 个角色的详情…`)
    const detailsBody = { nikke_area_id: parseInt(areaId, 10), name_codes: nameCodes }
    if (intlOpenId) detailsBody.intl_open_id = intlOpenId
    const details = await request(ENDPOINTS.characterDetails, detailsBody)
    if (!isOk(details)) throw new Error(details?.msg ? `读取角色详情失败：${details.msg}` : '读取角色详情失败')

    const effectsMap = new Map()
    for (const effect of Array.isArray(details?.data?.state_effects) ? details.data.state_effects : []) {
      if (effect?.id !== undefined) effectsMap.set(String(effect.id), effect)
    }

    onStep('整理数据…')
    const missCounter = {}
    const characters = (Array.isArray(details?.data?.character_details) ? details.data.character_details : [])
      .map((detail) => toCharacterEntry(detail, effectsMap, missCounter))
      .filter((item) => item.nameCode)

    // 自检：哪些字段一个都没取到，说明接口口径变了，写进文件让导入端能看见
    const warnings = Object.entries(missCounter)
      .filter(([, count]) => count === characters.length)
      .map(([field]) => `字段「${field}」在所有角色上都没取到，可能是接口口径变化`)

    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      source: 'blablalink',
      exportedAt: new Date().toISOString(),
      areaId,
      profileName,
      synchroLevel: Number.isFinite(Number(outpost.synchro_level)) ? Number(outpost.synchro_level) : null,
      outpostLevel: Number.isFinite(Number(outpost.outpost_battle_level)) ? Number(outpost.outpost_battle_level) : null,
      researches,
      characters,
      warnings,
    }
  }

  const download = (data) => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const safeName = String(data.profileName || 'account').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `nikke-photos-${safeName}-${stamp}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    return anchor.download
  }

  // ------------------------------ 界面 ------------------------------
  const CSS = `
    #${PANEL_ID} { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      width: 268px; font: 12px/1.6 -apple-system, "Microsoft YaHei", sans-serif;
      color: #1b1f24; background: #fff; border: 1px solid #d3d7db; border-radius: 8px;
      box-shadow: 0 6px 24px rgba(20, 24, 28, .18); overflow: hidden; }
    #${PANEL_ID} .nkp-head { display: flex; align-items: center; justify-content: space-between;
      padding: 8px 10px; background: #f4f6f8; border-bottom: 1px solid #e3e7ea;
      font-weight: 600; cursor: pointer; user-select: none; }
    #${PANEL_ID} .nkp-fold { color: #6b7480; font-weight: 400; }
    #${PANEL_ID} .nkp-body { display: grid; gap: 8px; padding: 10px; }
    #${PANEL_ID}.is-folded .nkp-body { display: none; }
    #${PANEL_ID} .nkp-note { margin: 0; color: #6b7480; font-size: 11px; }
    #${PANEL_ID} .nkp-status { margin: 0; min-height: 16px; color: #3a424c; overflow-wrap: anywhere; }
    #${PANEL_ID} .nkp-status.is-error { color: #c0392b; }
    #${PANEL_ID} .nkp-status.is-ok { color: #1f7a4d; }
    #${PANEL_ID} button { height: 30px; padding: 0 12px; font: inherit; font-weight: 600;
      color: #fff; background: #e8611c; border: 0; border-radius: 6px; cursor: pointer; }
    #${PANEL_ID} button[disabled] { opacity: .55; cursor: default; }
  `

  /**
   * 注入样式。
   * 优先走 GM_addStyle：有的站点 CSP 禁止内联样式，那样 `document.head.appendChild(<style>)`
   * 会被拦掉——面板 DOM 其实在，但会变成页面底部一坨裸文字，看起来就像"没出现"。
   */
  const addStyle = (css) => {
    if (typeof GM_addStyle === 'function') {
      try {
        GM_addStyle(css)
        return
      } catch (error) {
        console.warn('[NIKKE Photos] GM_addStyle 失败，改用 <style>：', error)
      }
    }
    const style = document.createElement('style')
    style.textContent = css
    ;(document.head || document.documentElement).appendChild(style)
  }

  const mountPanel = () => {
    if (document.getElementById(PANEL_ID)) return
    addStyle(CSS)

    const panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.innerHTML = `
      <div class="nkp-head"><span>NIKKE Photos 导出</span><span class="nkp-fold">[–]</span></div>
      <div class="nkp-body">
        <p class="nkp-note">读取你自己账号的妮姬数据并导出 JSON。数据只在本机处理，不会上传。</p>
        <button type="button" class="nkp-run">导出到 NIKKE Photos</button>
        <p class="nkp-status"></p>
      </div>
    `
    document.body.appendChild(panel)

    const head = panel.querySelector('.nkp-head')
    const fold = panel.querySelector('.nkp-fold')
    const runButton = panel.querySelector('.nkp-run')
    const status = panel.querySelector('.nkp-status')

    head.addEventListener('click', () => {
      panel.classList.toggle('is-folded')
      fold.textContent = panel.classList.contains('is-folded') ? '[+]' : '[–]'
    })

    const setStatus = (text, kind = '') => {
      status.textContent = text
      status.className = `nkp-status${kind ? ` is-${kind}` : ''}`
    }

    let running = false
    const run = async () => {
      if (running) return
      running = true
      runButton.disabled = true
      setStatus('准备中…')
      try {
        const data = await collectAccountData((step) => setStatus(step))
        const filename = download(data)
        setStatus(`已导出 ${data.characters.length} 个角色 → ${filename}`, 'ok')
      } catch (error) {
        setStatus(friendlyError(error), 'error')
        console.error('[NIKKE Photos] 导出失败：', error)
      } finally {
        running = false
        runButton.disabled = false
        runButton.textContent = '再导出一次'
      }
    }

    runButton.addEventListener('click', run)
    return run
  }

  let run = null
  try {
    run = mountPanel()
    console.log(`[NIKKE Photos] 浮窗已挂载：${run ? '成功' : '已存在，跳过'}`)
  } catch (error) {
    console.error('[NIKKE Photos] 浮窗挂载失败：', error)
  }
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('导出账号数据到 NIKKE Photos', () => run?.())
  }
})()
