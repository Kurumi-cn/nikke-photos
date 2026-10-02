import { Link } from 'react-router-dom'
import { assetUrl, iconFor, labelFor } from '../lib/roster.js'

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
            title={character.nameCn}
          >
            <div className="thumb">
              {character.avatar ? (
                <img src={assetUrl(character.avatar)} alt={character.nameCn} loading="lazy" decoding="async" />
              ) : (
                <span className="ph">无头像</span>
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
              {recordedCodes?.has(character.nameCode) ? <span className="recorded" title="已录入数据" /> : null}
            </div>
            <div className="name">{character.nameCn}</div>
          </Link>
        )
      })}
    </div>
  )
}