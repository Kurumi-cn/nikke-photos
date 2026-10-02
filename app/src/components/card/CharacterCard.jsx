import { useMemo, useState } from 'react'
import { assetUrl } from '../../lib/roster.js'
import { CARD_HEIGHT, CARD_WIDTH, DEFAULT_MODULES } from '../../lib/cardLayout.js'
import { buildCardData, formatPercent } from '../../lib/cardModel.js'
import { coreFrameAsset, decorAsset, metaAsset, overloadBadgeAsset, starAsset } from '../../lib/cardAssets.js'
import './characterCard.css'

const ARTWORK_ROOT = 'ui-assets/nikke/character-artwork'

function Decoration({ name, className = '' }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <span className={`np-decoration ${className}`} aria-hidden="true">
      <img src={decorAsset(name)} alt="" onError={() => setFailed(true)} />
    </span>
  )
}

function LevelBadge({ value, label }) {
  return (
    <small className="np-level-badge" aria-label={label}>
      <Decoration name="level-badge" />
      <b>{value}</b>
    </small>
  )
}

function MetaItem({ group, value, kind, level }) {
  const src = metaAsset(group, value)
  const hasLevel = group === 'class' || group === 'manufacturer'
  const label = `${value || '未知'}${hasLevel ? `，等级 ${level ?? '—'}` : ''}`
  return (
    <span className={`np-meta ${kind}`} title={label} aria-label={label}>
      {src ? <img src={src} alt="" /> : <span aria-hidden="true">—</span>}
      {hasLevel ? (
        <small className="np-meta-level" aria-hidden="true">
          <b>LV.</b>
          <strong>{level ?? '—'}</strong>
        </small>
      ) : null}
    </span>
  )
}

function FavoriteItemPanel({ data }) {
  const item = data.favoriteItem
  if (!item) return null
  const rarity = String(item.rarity || '').toLowerCase()
  return (
    <section
      className={`np-favorite is-${rarity || 'unknown'}${item.isFavorite && item.asset ? ' has-icon' : ''}`}
      aria-label={`${item.isFavorite ? '珍藏品' : '收藏品'} ${item.rarity}，${item.stars ?? '—'}星`}
    >
      <span className="np-favorite-mascot" aria-hidden="true">
        {item.asset ? <img src={item.asset} alt="" /> : null}
      </span>
      <span className="np-favorite-stars" aria-hidden="true">
        {item.stars === null
          ? <b>—</b>
          : [0, 1, 2].map((index) => (
            <i key={index} className={index < item.stars ? 'filled' : undefined}>★</i>
          ))}
      </span>
    </section>
  )
}

function SkillPanel({ data }) {
  if (!data.skills.length) return null
  const standard = data.skills.filter((skill) => skill.key !== 'burst')
  const burst = data.skills.find((skill) => skill.key === 'burst')
  const renderSkill = (skill) => (
    <span className={`np-skill is-${skill.key}`} key={skill.key} title={`${skill.label} LV.${skill.level}`}>
      <Decoration name="skill-frame" className="np-skill-frame" />
      <img className="np-skill-glyph" src={assetUrl(skill.url)} alt={skill.label} />
      <LevelBadge value={skill.level} label={`等级 ${skill.level}`} />
    </span>
  )
  return (
    <section className="np-skills" aria-label="技能等级">
      <span className="np-standard-skills">{standard.map(renderSkill)}</span>
      {burst ? renderSkill(burst) : null}
    </section>
  )
}

function CubePanel({ data }) {
  if (!data.cube) return null
  return (
    <section className="np-cube" aria-label={`${data.cube.name}，等级 ${data.cube.level ?? '未知'}`} title={data.cube.name}>
      <span className="np-cube-art" aria-hidden="true">
        {data.cube.asset ? <img src={data.cube.asset} alt="" /> : <b>◇</b>}
      </span>
      <LevelBadge value={data.cube.level ?? '—'} label={`等级 ${data.cube.level ?? '未知'}`} />
    </section>
  )
}

function IdentityPanel({ data, modules }) {
  const filledStars = data.limitBreak.grade
  const hasContent = ['rarity', 'levelName', 'affection', 'combat', 'metadata']
    .some((key) => modules[key])
  if (!hasContent) return null
  return (
    <section className="np-identity" aria-label={`${data.name}角色信息`}>
      {modules.rarity ? (
        <div className="np-rarity-row">
          {data.rarityAsset
            ? <img className="np-rarity" src={data.rarityAsset} alt={`稀有度 ${data.rarity}`} />
            : <span className="np-rarity np-rarity-fallback">{data.rarity || '—'}</span>}
          <div className="np-breakthrough" aria-label={`${filledStars}星，核心突破 ${data.limitBreak.coreBadge || 0}`}>
            <span className="np-stars" aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <img key={index} src={starAsset(index < filledStars)} alt="" />
              ))}
            </span>
            {data.limitBreak.coreBadge ? (
              <span className="np-core">
                <img src={coreFrameAsset()} alt="" />
                <strong className={data.limitBreak.coreBadge === 'MAX' ? 'is-max' : undefined}>
                  {data.limitBreak.coreBadge}
                </strong>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {modules.levelName ? (
        <div className={`np-level-name${data.name.length >= 8 ? ' long-name' : ''}`}>
          <span className="np-level">LV. <strong>{data.level ?? '—'}</strong></span>
          <h2 title={data.name}>{data.name}</h2>
        </div>
      ) : null}

      {modules.affection ? (
        <div className="np-affection" aria-label={`好感度 ${data.affection ?? '未知'}`}>
          <Decoration name="affection-frame" />
          <span className="np-affection-caption"><b aria-hidden="true">»</b> attraction</span>
          <strong>RANK</strong>
          <em className={String(data.affection ?? '—').length > 2 ? 'is-wide' : undefined}>
            <Decoration name="heart" />
            <b>{data.affection ?? '—'}</b>
          </em>
        </div>
      ) : null}

      {modules.combat ? (
        <div className="np-combat">
          <span>战斗力</span>
          <strong>{data.combat ?? '—'}</strong>
          <b>BATTLE</b>
        </div>
      ) : null}

      {modules.metadata ? (
        <div className="np-meta-stack">
          <span className="np-meta-row">
            <MetaItem group="burst" value={data.burstStage} kind="native" />
            <MetaItem group="element" value={data.element} kind="native element" />
            <MetaItem group="weapon" value={data.weaponType} kind="glyph weapon" />
          </span>
          <span className="np-meta-row">
            <MetaItem group="class" value={data.className} kind="glyph class" level={data.classLevel} />
            <MetaItem group="manufacturer" value={data.corporation} kind="glyph manufacturer" level={data.corporationLevel} />
          </span>
        </div>
      ) : null}
    </section>
  )
}

function AffixValue({ line }) {
  if (!line) {
    return (
      <>
        <span className="np-affix-name">—</span>
        <span className="np-affix-values">—</span>
      </>
    )
  }
  return (
    <>
      <span className="np-affix-name" title={line.label}>{line.label}</span>
      <span className="np-affix-values">
        <span>【<span className="np-num">{line.level ?? '—'}</span>档】</span>
        <strong>{formatPercent(line.value)}</strong>
      </span>
    </>
  )
}

function EquipmentCard({ data, slotIndex }) {
  const equipment = data.equipmentDisplays[slotIndex]
  const classIcon = metaAsset('class', equipment.className)
  const manufacturerIcon = metaAsset('manufacturer', equipment.manufacturer)
  return (
    <article className="np-equipment">
      <span
        className={`np-equipment-icon${equipment.isOverload ? '' : ' is-standard'}`}
        title={equipment.label}
        aria-label={equipment.label}
      >
        {equipment.icon
          ? <img className="np-equipment-art" src={equipment.icon} alt="" />
          : <span className="np-equipment-placeholder">{equipment.state === 'empty' ? '未装备' : '暂无图标'}</span>}
        <span className="np-equipment-badges" aria-hidden="true">
          {equipment.isOverload ? (
            <span className="np-overload-badge"><img src={overloadBadgeAsset()} alt="" /></span>
          ) : null}
          {manufacturerIcon ? (
            <span className="np-class-badge np-manufacturer-badge"><i /><img src={manufacturerIcon} alt="" /></span>
          ) : null}
          {classIcon ? (
            <span className="np-class-badge"><i /><img src={classIcon} alt="" /></span>
          ) : null}
        </span>
        {equipment.tier && !equipment.isOverload ? (
          <span className="np-equipment-tier">{equipment.tier}</span>
        ) : null}
      </span>
      <div className="np-affix-lines">
        {data.equipments[slotIndex].map((line, lineIndex) => {
          const tier = Number(line?.level)
          const tierClass = tier === 15 ? 'tier-15' : tier >= 12 ? 'tier-blue' : ''
          return (
            <div className={`np-affix-line ${tierClass}`} key={lineIndex}>
              <AffixValue line={line} />
            </div>
          )
        })}
      </div>
    </article>
  )
}

function EquipmentPanel({ data, modules }) {
  if (!modules.affixSummary && !modules.equipments) return null
  return (
    <section className="np-equipment-panel" aria-label="四件装备和词条">
      {modules.affixSummary && data.topAffixes.length ? (
        <div className="np-affix-summary" aria-label="档位合计最高的三个词条">
          {data.topAffixes.map((item) => (
            <div key={item.functionType}>
              <span title={item.label}>{item.label}</span>
              <span><span>【<span className="np-num">{item.totalLevel}</span>档】</span><strong>{formatPercent(item.totalValue)}</strong></span>
            </div>
          ))}
        </div>
      ) : null}
      {modules.equipments ? (
        <div className="np-equipment-grid">
          {[0, 1, 2, 3].map((slotIndex) => (
            <EquipmentCard key={slotIndex} data={data} slotIndex={slotIndex} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

/** 736×1096 角色卡（导出对象即根节点） */
export default function CharacterCard({
  character,
  profile,
  synchroLevel,
  research,
  artwork,
  transform,
  modules = DEFAULT_MODULES,
  signature,
  transparent = false,
  panelScale = 150,
  cardRef,
}) {
  const data = useMemo(
    () => buildCardData(character, profile, { synchroLevel, research }),
    [character, profile, synchroLevel, research],
  )
  const [failedArtwork, setFailedArtwork] = useState('')
  const artworkUrl = artwork?.file ? assetUrl(`${ARTWORK_ROOT}/${artwork.file}`) : ''
  const showArtwork = artworkUrl && failedArtwork !== artworkUrl
  const scale = transform?.scale ?? 100
  // 位移随缩放联动：translate 的百分比基准是立绘自身尺寸，若位移不随缩放放大，
  // 立绘放大后滑块的视觉灵敏度会明显变钝（300% 时同样一格只挪 1/3 的相对距离）
  const offsetX = ((transform?.offsetX ?? 50) - 50) * (scale / 100)
  const offsetY = (transform?.offsetY ?? 0) * (scale / 100)
  const showSignature = signature?.enabled && String(signature.text || '').trim() !== ''

  return (
    <article
      ref={cardRef}
      className={`np-card${transparent ? ' is-transparent' : ''}${modules.favoriteItem && data.favoriteItem ? ' has-favorite' : ''}`}
      style={{
        '--card-width': `${CARD_WIDTH}px`,
        '--card-height': `${CARD_HEIGHT}px`,
        '--panel-scale': String(panelScale / 100),
      }}
      aria-label={`${data.name}角色卡`}
    >
      {showArtwork ? (
        <img
          className="np-card-art"
          src={artworkUrl}
          alt={`${data.name}立绘`}
          draggable={false}
          style={{ transform: `translate(${offsetX}%, ${offsetY}%) scale(${scale / 100})` }}
          onError={() => setFailedArtwork(artworkUrl)}
        />
      ) : (
        <div className="np-card-art-placeholder"><span>暂无可用全身立绘</span></div>
      )}

      {modules.favoriteItem && data.favoriteItem ? <FavoriteItemPanel data={data} /> : null}
      {modules.skills ? <SkillPanel data={data} /> : null}
      {modules.cube ? <CubePanel data={data} /> : null}
      <IdentityPanel data={data} modules={modules} />
      <EquipmentPanel data={data} modules={modules} />

      {showSignature ? <span className="np-signature">{signature.text}</span> : null}
    </article>
  )
}