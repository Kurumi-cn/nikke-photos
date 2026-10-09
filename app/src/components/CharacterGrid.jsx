import { Link } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { assetUrl, displayName, iconFor, labelFor } from '../lib/roster.js'

export default function CharacterGrid({ characters, tileSize, recordedCodes }) {
  return (
    <div className="grid" style={{ '--tile-size': tileSize }}>
      {characters.map((character) => {
        const elementIcon = iconFor('element', character.element)
        const burstIcon = iconFor('use_burst_skill', character.use_burst_skill)
        return (
          <Link
            key={character.nameCode}
            className="tile"
            to={`/character/${character.nameCode}`}
            title={displayName(character)}
          >
            <div className="thumb">
              {character.avatar ? (
                <img src={assetUrl(character.avatar)} alt={displayName(character)} loading="lazy" decoding="async" />
              ) : (
                <span className="ph">{t('无头像')}</span>
              )}
              {elementIcon && (
                <img
                  className="elem"
                  src={assetUrl(elementIcon)}
                  alt=""
                  title={labelFor('element', character.element)}
                />
              )}
              {burstIcon && (
                <img
                  className="burst"
                  src={assetUrl(burstIcon)}
                  alt=""
                  title={labelFor('use_burst_skill', character.use_burst_skill)}
                />
              )}
              {recordedCodes?.has(character.nameCode) ? <span className="recorded" title={t('已录入数据')} /> : null}
            </div>
            <div className="name">{displayName(character)}</div>
          </Link>
        )
      })}
    </div>
  )
}