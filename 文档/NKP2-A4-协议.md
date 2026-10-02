# NKP2 分享码协议（变体 A4）

> 面向 BOT 端实现者。本文档是协议的唯一权威说明。
> App 侧编码实现在 `app/src/lib/shareCode.js`，BOT 侧解码实现在
> `bot/astrbot_plugin_nikke_roster/core/sharecode.py`（与本文档第 11 节同源）。
> 文中所有长度、示例码与解析结果都由 `node app/scripts/check-share-code.mjs` 实测输出，
> 并由 `bot/tools/check-protocol.ps1` 做 **JS 编码 → Python 解码** 跨语言核对。

## 1. 它是什么

网页端把练度数据编码成一段字符串，形如：

```
NKP2:AAIAAf8AyDIMgyDIMgyDIMico3eBv1Kqofi8fLDpodQAdL5M6YwAKnIUUA
```

- 前缀 `NKP2:` 固定，便于识别；
- 后面是 **base64url**（字符集 `A-Z a-z 0-9 - _`，无 `=` 补位）；
- base64url 解码后是**一条紧凑的二进制字节流**，所有数值按位打包；
- **不做 gzip**：位打包后字节流没有冗余，再压缩反而变大。

同一条导入命令靠**载荷类型**自动分派，目前有两种：

| 类型 | 名称 | 带什么 | 用途 |
| --- | --- | --- | --- |
| `0` | 角色数据 | 1~10 个角色的练度明细 | 把网页端练度搬进 BOT |
| `1` | 表格配置 | 只有角色名单与行序 | 「只调个兵」：BOT 按这个顺序，从**该 QQ 自己已录入**的数据里排练度统计表 |

长度参考（字符数，含 `NKP2:` 前缀）：

| 导出字段 | 1 个角色 | 10 个角色 |
| --- | --- | --- |
| 只有装备词条（默认） | 39 | 203 |
| 装备 + 技能 | 41 | 223 |
| 装备 + 技能 + 魔方 + 收藏品 | 44 | 252 |
| 装备 + 技能 + 魔方 + 收藏品 + 研究等级 | 57 | 265 |
| 全部 8 项 | 63 | 324 |

## 2. 与 0.1（变体 A3）的差别

**A3 已废弃，A4 不兼容 A3，不做旧码兼容**（A3 从未真正发出去过，没有历史数据包袱）。

| 变更 | 原因 |
| --- | --- |
| 版本 `0.1` → `0.2`（线上值 `1` → `2`） | 布局变了，版本必须能区分 |
| 版本号后插入 1 字节**载荷类型** | 导入命令要能自动识别「这是练度码还是表格码」 |
| 角色 id 由 9 bit 的 `nameCode − 5000` 改成 **13 bit 直接写 `nameCode`** | 旧算法对 `nameCode < 5000` 的角色直接抛错，实测 201 个角色里有 **35 个编不出来**，包含拉毗、尼恩、阿妮斯、D、拉普拉斯、樱花、毒蛇、牡丹、豺狼——等于起手队都分享不了 |
| 「条目数」提到类型之后，两种载荷共用同一位置 | 解码时先读统一头，再按类型分支，逻辑更简单 |
| 空值判定修正（`null` 不能再被当成 `0`） | 旧实现里 `Number(null) === 0`，导致「没填星级」被导出成「0 星」，BOT 端也不会再套默认值。星级 / 核心 / 好感度三个字段的哨兵都在合法区间之外，正是最需要它生效的地方 |

## 3. 字节流结构

多字节整数一律 **大端（big-endian）**；跨字节的位字段一律 **MSB-first**（高位先写）。

| 偏移 | 长度 | 字段 | 说明 |
| --- | --- | --- | --- |
| 0 | 2 字节 | 版本 | `uint16 = 主版本 × 100 + 次版本`；当前 `0.2` → 值 `2` |
| 2 | 1 字节 | 载荷类型 | `0` = 角色数据；`1` = 表格配置 |
| 3 | 1 字节 | 条目数 | 类型 0：角色数 `[1,10]`；类型 1：行数 `[1,255]` |
| 4 | … | 类型专属载荷 | 见第 3.1 节 |
| 末 4 字节 | 4 字节 | CRC32 | 覆盖前面**全部**字节，标准 CRC-32（多项式 `0xEDB88320`，即 `zlib.crc32`） |

版本号**必须完全一致**才解析。布局改过，硬解析旧码会解出垃圾数据——宁可明确报
「版本不一致，请到网页端重新导出」。

### 3.1 类型专属载荷

**类型 0（角色数据）**

| 偏移（相对第 4 字节） | 长度 | 字段 |
| --- | --- | --- |
| 0 | 1 字节 | 字段掩码 |
| 1 | 2 字节 | 同步器等级 `[1,2000]` |
| 3 | 80 bit | 研究等级（**仅当掩码含 `research`**）：先企业 5 个、后职业 3 个，各 10 bit |
| … | 可变 | 角色记录 × 角色数（见第 6 节） |

**类型 1（表格配置）**

| 偏移（相对第 4 字节） | 长度 | 字段 |
| --- | --- | --- |
| 0 | 13 bit × 行数 | 角色 id 序列，**顺序即表格行序** |

类型 1 **不传任何练度数值**，也不传同步器等级 / 研究等级。

### 3.2 字段掩码（类型 0 的第 1 个字节）

| 位 | 字段 key | 界面名称 |
| --- | --- | --- |
| 0 | `equip` | 装备词条（**恒为 1**，必选） |
| 1 | `research` | 研究等级 |
| 2 | `skills` | 技能等级 |
| 3 | `cube` | 魔方 |
| 4 | `favorite` | 收藏品 |
| 5 | `limitBreak` | 星级 / 突破 |
| 6 | `affection` | 好感度 |
| 7 | `combat` | 战斗力 |

掩码为 0 的字段**完全不写入字节流**，BOT 端请套用第 9 节的默认值。

## 4. 位字段约定

- **位序 MSB-first**：一个字段从高位写到低位。例如 3 bit 写值 `5`（二进制 `101`）占的位置就是 `1 0 1`。
- 字段之间**紧密相接、不补齐**，只有整条字节流结束时才补 0 到字节边界。
- 读取时若越界 → 判定分享码不完整。

## 5. 角色 id（13 bit）

直接写 `nameCode` 的**原值**，取值 `0 ~ 8189`。

| 值 | 含义 |
| --- | --- |
| `0 ~ 8189` | 就是 `nameCode` 本身（当前角色表实际范围 `1007 ~ 5180`） |
| `8190` | `cn-exclusive-huapi`（画皮，没有数字 id） |
| `8191` | `cn-exclusive-yingning`（婴宁，没有数字 id） |

不引入映射表：以后新增角色（`nameCode` 落在 5000+ 段）自动可用，协议不用改。
13 bit 上限 8191，余量充足。

## 6. 类型 0：每个角色的字段

**固定按此顺序写入**，掩码只决定某个字段「写不写」，不改变顺序：

```
id → limitBreak → affection → combat → skills → cube → favorite → equipments
```

| 字段 | 位宽 | 取值范围 | 缺值哨兵 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | 13 bit | `0~8189` / `8190` / `8191` | — | 见第 5 节 |
| 星级 | 3 bit | `[0,3]` | `7` | App 的「突破（星）」 |
| 突破（核心） | 4 bit | `[0,7]` | `15` | App 的「核心」 |
| 好感度 | 6 bit | `[0,40]` | `41` | |
| 战斗力 | 22 bit | `[1,4000000]` | `0` | |
| 技能 1/2/爆裂 | 4 bit × 3 | `[1,10]` | `0` | 顺序固定：技能1、技能2、爆裂 |
| 魔方类型 | 5 bit | `[0,17]` | `0` | `0` = 无魔方；`1-17` = `CUBE_IDS[值-1]` |
| 魔方等级 | 4 bit | `[0,15]` | `0` | 无魔方时写 0 |
| 收藏品类型 | 5 bit | `[0,23]` | `0` | `0` = 无；`1` = R；`2` = SR；`3-23` = `FAVORITE_KEYS[值-3]`（SSR 珍藏品） |
| 收藏品等级 | 4 bit | `[0,15]` | `0` | R/SR 用 `1-15`；**SSR 珍藏品只用 `1-3`**（线上是界面值，App 内部存 0~2） |
| 装备词条 | 8 bit × 12 | — | — | 见下 |

### 6.1 装备词条（12 行）

4 个部位（头 / 身 / 臂 / 腿）× 每部位 3 行，共 12 组，每组 8 bit：

- 前 4 bit = **词条类型**：`0` 表示这一行为空；`1-9` 表示 `AFFIX_TYPES[值-1]`
- 后 4 bit = **档位**：`1-15`；空行时写 `0`

**词条数值不传输**：由「类型 + 档位」查表推导（档位表见 App 的 `app/src/data/affixTiers.js`）。

### 6.2 哨兵规则（重要）

哨兵值**必须落在该字段的合法区间之外**。例如核心取值 `[0,7]`，若哨兵也用 `7`，
满级核心就会被解成「无数据」——因此核心占 4 bit、哨兵取 `15`。

BOT 端解码时：**读到哨兵 → 该字段视为「未提供」**（此时应套用第 9 节默认值，
而不是当作 0）。注意「未提供」与「用户真的填了 0」是两件事，不要合并。

编码端同理：`null` / `undefined` / 空串一律写哨兵，**绝不能**因为 `Number(null) === 0`
就当成合法值 0 写出去。

## 7. 类型 1：表格配置载荷

只有一串 13 bit 的角色 id，顺序就是练度统计表的行序：

```
条目数(1B) 之后紧接：id[0] (13 bit) | id[1] (13 bit) | ... | id[N-1] (13 bit)
```

BOT 收到后：按这个顺序，从**发起人自己**的练度库里取角色数据来排表。
名单里的角色如果 BOT 那边没有数据，提示用户先导入角色数据码，或跳过该行。

## 8. 冻结字典

以下三张表的顺序**已写死**：只能往后追加，**绝不重排、绝不删除**。否则历史分享码会解成别的道具。

```python
AFFIX_TYPES = [
    "IncElementDmg", "StatAtk", "StatAmmoLoad", "StatChargeTime", "StatChargeDamage",
    "StatCritical", "StatCriticalDamage", "StatAccuracyCircle", "StatDef",
]  # 9 个；线上写 序号+1（0 留给空行）

CUBE_IDS = [
    10001, 10002, 10003, 10004, 10005, 10006, 11001, 13001, 12001,
    13002, 12002, 10009, 10007, 10008, 10010, 10012, 10013,
]  # 17 个；线上写 序号+1（0 留给"无魔方"）。注意 resourceId 不连续！

FAVORITE_KEYS = [
    "c030", "c032", "c072", "c080", "c100", "c101", "c112", "c140", "c141", "c142", "c150",
    "c170", "c192", "c210", "c280", "c281", "c352", "c390", "c411", "c550", "c580",
]  # 21 个珍藏品；线上写 序号+3（0/1/2 留给 无/R/SR）
```

常用对照：**遗迹巨熊魔方 = `CUBE_IDS[2]` = `10003`，线上类型值写 `3`**。

## 9. 未导出字段的默认值

掩码为 0 的字段（以及读到哨兵的字段），BOT 端按此填充：

| 属性 | 默认值 |
| --- | --- |
| 星级 | 3 |
| 突破（核心） | 7 |
| 好感度 | 30 |
| 战斗力 | 114514 |
| 技能 1 / 2 / 爆裂 | 10 / 10 / 10 |
| 魔方类型 | 遗迹巨熊魔方（`CUBE_IDS[2]`） |
| 魔方等级 | 15 |
| 收藏品类型 | SR |
| 收藏品等级 | 15 |
| 企业研究等级 | 200 |
| 职业研究等级 | 200 |

> App 侧在用户首次进入导出页时会弹窗说明这份默认值，并提供「不再提醒」。

## 10. 完整示例

**类型 0**：1 个角色、全部 8 项都勾，共 63 字符：

```
NKP2:AAIAAf8AyDIMgyDIMgyDIMico3eBv1Kqofi8fLDpodQAdL5M6YwAKnIUUA
```

原数据（用于核对）：

| 项 | 值 |
| --- | --- |
| 角色 | `5012`（白雪公主） |
| 星级 / 突破 | 3 / 7 |
| 好感度 / 战斗力 | 30 / 114514 |
| 技能 1/2/爆裂 | 10 / 10 / 10 |
| 魔方 | 遗迹巨熊魔方（10003）15 级 |
| 收藏品 | SR 15 级 |
| 企业 / 职业研究等级 | 全部 200 |
| 同步器等级 | 200 |

解析结果（Python 实测输出）：

```json
{
  "version": 2,
  "payloadType": 0,
  "fields": ["equip", "research", "skills", "cube", "favorite", "limitBreak", "affection", "combat"],
  "synchroLevel": 200,
  "research": {
    "corporation": { "ELYSION": 200, "MISSILIS": 200, "TETRA": 200, "PILGRIM": 200, "ABNORMAL": 200 },
    "class": { "Attacker": 200, "Defender": 200, "Supporter": 200 }
  },
  "characters": {
    "5012": {
      "limitBreak": { "grade": 3, "core": 7 },
      "affection": 30,
      "combat": 114514,
      "skills": { "skill1": 10, "skill2": 10, "burst": 10 },
      "cube": { "resourceId": 10003, "level": 15 },
      "favoriteItem": { "rarity": "SR", "level": 15, "resourceKey": null },
      "equipments": [
        [{ "functionType": "IncElementDmg", "level": 15, "value": 29.16 },
         { "functionType": "StatAtk", "level": 12, "value": 12.52 },
         { "functionType": "StatAmmoLoad", "level": 10, "value": 64.82 }],
        [{ "functionType": "StatCritical", "level": 8, "value": 4.69 },
         { "functionType": "StatCriticalDamage", "level": 5, "value": 10.56 },
         null],
        [{ "functionType": "IncElementDmg", "level": 13, "value": 26.36 },
         { "functionType": "StatAtk", "level": 15, "value": 14.63 },
         { "functionType": "StatDef", "level": 3, "value": 6.18 }],
        [{ "functionType": "StatAmmoLoad", "level": 10, "value": 64.82 },
         { "functionType": "StatCritical", "level": 3, "value": 2.98 },
         null]
      ]
    }
  }
}
```

> 解出来的 `value` 是解码端**查档位表算出来的**，不是码里传的。
> 未导出的字段解出来是 `null`（不是默认值）；要用默认值请调第 11 节的 `apply_defaults()`。

## 11. Python 参考实现

以下代码与 BOT 实际使用的 `core/sharecode.py` 同源，可整段复制（Python 3.10+）。

```python
import base64
import struct
import zlib

SHARE_VERSION = 2
PAYLOAD_CHARACTERS, PAYLOAD_TABLE = 0, 1
SHARE_MAX_COUNT, TABLE_MAX_COUNT = 10, 255

SHARE_FIELDS = [("equip", 0), ("research", 1), ("skills", 2), ("cube", 3),
                ("favorite", 4), ("limitBreak", 5), ("affection", 6), ("combat", 7)]

AFFIX_TYPES = [
    "IncElementDmg", "StatAtk", "StatAmmoLoad", "StatChargeTime", "StatChargeDamage",
    "StatCritical", "StatCriticalDamage", "StatAccuracyCircle", "StatDef",
]
CUBE_IDS = [10001, 10002, 10003, 10004, 10005, 10006, 11001, 13001, 12001,
            13002, 12002, 10009, 10007, 10008, 10010, 10012, 10013]
FAVORITE_KEYS = ["c030", "c032", "c072", "c080", "c100", "c101", "c112", "c140", "c141", "c142", "c150",
                 "c170", "c192", "c210", "c280", "c281", "c352", "c390", "c411", "c550", "c580"]

# 词条档位表（类型 → 15 个档位的百分比数值）；这里给个占位，实际用完整的表
AFFIX_TIER_VALUES = {
    "IncElementDmg": [9.54, 10.94, 12.34, 13.75, 15.15, 16.55, 17.95, 19.35, 20.75, 22.15, 23.56, 24.96, 26.36, 27.76, 29.16],
    "StatAtk": [4.77, 5.47, 6.18, 6.88, 7.59, 8.29, 9.00, 9.70, 10.40, 11.11, 11.81, 12.52, 13.22, 13.93, 14.63],
    "StatAmmoLoad": [27.84, 31.95, 36.06, 40.17, 44.28, 48.39, 52.50, 56.60, 60.71, 64.82, 68.93, 73.04, 77.15, 81.26, 85.37],
    "StatChargeTime": [1.98, 2.28, 2.57, 2.86, 3.16, 3.45, 3.75, 4.04, 4.33, 4.63, 4.92, 5.21, 5.51, 5.80, 6.09],
    "StatChargeDamage": [4.77, 5.47, 6.18, 6.88, 7.59, 8.29, 9.00, 9.70, 10.40, 11.11, 11.81, 12.52, 13.22, 13.93, 14.63],
    "StatCritical": [2.30, 2.64, 2.98, 3.32, 3.66, 4.00, 4.35, 4.69, 5.03, 5.37, 5.71, 6.05, 6.39, 6.73, 7.07],
    "StatCriticalDamage": [6.64, 7.62, 8.60, 9.58, 10.56, 11.54, 12.52, 13.50, 14.48, 15.46, 16.44, 17.42, 18.40, 19.38, 20.36],
    "StatAccuracyCircle": [4.77, 5.47, 6.18, 6.88, 7.59, 8.29, 9.00, 9.70, 10.40, 11.11, 11.81, 12.52, 13.22, 13.93, 14.63],
    "StatDef": [4.77, 5.47, 6.18, 6.88, 7.59, 8.29, 9.00, 9.70, 10.40, 11.11, 11.81, 12.52, 13.22, 13.93, 14.63],
}

W = {"id": 13, "grade": 3, "core": 4, "affection": 6, "combat": 22, "skill": 4,
     "cubeType": 5, "cubeLevel": 4, "favoriteType": 5, "favoriteLevel": 4,
     "affixType": 4, "affixTier": 4, "research": 10}
SENTINEL = {"grade": 7, "core": 15, "affection": 41}
SENTINEL_CHAR_IDS = {8190: "cn-exclusive-huapi", 8191: "cn-exclusive-yingning"}

WIRE_RESEARCH = [("corporation", "ELYSION"), ("corporation", "MISSILIS"), ("corporation", "TETRA"),
                 ("corporation", "PILGRIM"), ("corporation", "ABNORMAL"),
                 ("class", "Attacker"), ("class", "Defender"), ("class", "Supporter")]

DEFAULTS = {"grade": 3, "core": 7, "affection": 30, "combat": 114514, "skill": 10,
            "cube": 10003, "cubeLevel": 15, "favoriteRarity": "SR", "favoriteLevel": 15,
            "research": 200}


class ShareCodeError(ValueError):
    """分享码不可用，消息可直接回给用户。"""


class BitReader:
    """MSB-first 位读取器，越界即判定分享码不完整。"""

    def __init__(self, data):
        self.data, self.pos = data, 0

    def read(self, width):
        value = 0
        for _ in range(width):
            index = self.pos >> 3
            if index >= len(self.data):
                raise ShareCodeError("分享码内容不完整")
            value = (value << 1) | ((self.data[index] >> (7 - (self.pos & 7))) & 1)
            self.pos += 1
        return value


def decode_share_code(text):
    token = str(text).strip()
    if not token.startswith("NKP2:"):
        raise ShareCodeError("分享码格式不正确（应以 NKP2: 开头）")
    body64 = token[5:]
    try:
        payload = base64.urlsafe_b64decode(body64 + "=" * (-len(body64) % 4))
    except Exception as exc:
        raise ShareCodeError("分享码格式不正确（base64 解不开）") from exc
    if len(payload) < 8:
        raise ShareCodeError("分享码内容不完整")
    body, crc = payload[:-4], struct.unpack(">I", payload[-4:])[0]
    if zlib.crc32(body) & 0xFFFFFFFF != crc:
        raise ShareCodeError("分享码已损坏，请重新复制")

    br = BitReader(body)
    version = br.read(16)
    if version != SHARE_VERSION:
        raise ShareCodeError(f"分享码版本 {version // 100}.{version % 100} "
                             f"与当前版本 0.2 不一致，请到网页端重新导出")
    payload_type, count = br.read(8), br.read(8)

    if payload_type == PAYLOAD_TABLE:
        if count == 0:
            raise ShareCodeError("分享码内容不完整")
        name_codes = []
        for _ in range(count):
            wire = br.read(W["id"])
            name_codes.append(SENTINEL_CHAR_IDS.get(wire) or str(wire))
        return {"version": version, "payloadType": PAYLOAD_TABLE, "nameCodes": name_codes}

    if payload_type != PAYLOAD_CHARACTERS:
        raise ShareCodeError(f"不认识的分享码类型：{payload_type}")
    if count == 0 or count > SHARE_MAX_COUNT:
        raise ShareCodeError("分享码内容不完整")

    mask = br.read(8)
    fields = [key for key, bit in SHARE_FIELDS if mask & (1 << bit)]
    has = set(fields)
    synchro_level = br.read(16)

    research = {"corporation": {}, "class": {}}
    if "research" in has:
        for group, key in WIRE_RESEARCH:
            research[group][key] = br.read(W["research"])

    characters = {}
    for _ in range(count):
        wire = br.read(W["id"])
        characters[SENTINEL_CHAR_IDS.get(wire) or str(wire)] = _read_record(br, has)

    return {"version": version, "payloadType": PAYLOAD_CHARACTERS, "fields": fields,
            "synchroLevel": synchro_level, "research": research, "characters": characters}


def _read_record(br, has):
    record = {}
    if "limitBreak" in has:
        grade, core = br.read(W["grade"]), br.read(W["core"])
        record["limitBreak"] = {"grade": None if grade == SENTINEL["grade"] else grade,
                                "core": None if core == SENTINEL["core"] else core}
    if "affection" in has:
        affection = br.read(W["affection"])
        record["affection"] = None if affection == SENTINEL["affection"] else affection
    if "combat" in has:
        combat = br.read(W["combat"])
        record["combat"] = None if combat == 0 else combat
    if "skills" in has:
        values = [br.read(W["skill"]) for _ in range(3)]
        record["skills"] = {"skill1": values[0] or None, "skill2": values[1] or None,
                            "burst": values[2] or None}
    if "cube" in has:
        cube_type, cube_level = br.read(W["cubeType"]), br.read(W["cubeLevel"])
        record["cube"] = None if cube_type == 0 else {
            "resourceId": CUBE_IDS[cube_type - 1], "level": cube_level or None}
    if "favorite" in has:
        fav_type, fav_level = br.read(W["favoriteType"]), br.read(W["favoriteLevel"])
        if fav_type == 0 or fav_level == 0:
            record["favoriteItem"] = None
        elif fav_type in (1, 2):
            record["favoriteItem"] = {"rarity": "R" if fav_type == 1 else "SR",
                                      "level": fav_level, "resourceKey": None}
        else:
            index = fav_type - 3
            record["favoriteItem"] = {
                "rarity": "SSR",
                "resourceKey": FAVORITE_KEYS[index] if 0 <= index < len(FAVORITE_KEYS) else None,
                "level": fav_level - 1}   # 线上是界面值 1~3，落回内部表示 0~2
    if "equip" in has:
        slots = []
        for _slot in range(4):
            lines = []
            for _line in range(3):
                affix_type, tier = br.read(W["affixType"]), br.read(W["affixTier"])
                if affix_type == 0 or tier == 0 or affix_type > len(AFFIX_TYPES):
                    lines.append(None)
                else:
                    function_type = AFFIX_TYPES[affix_type - 1]
                    tiers = AFFIX_TIER_VALUES.get(function_type) or []
                    lines.append({"functionType": function_type, "level": tier,
                                  "value": tiers[tier - 1] if tier <= len(tiers) else None})
            slots.append(lines)
        record["equipments"] = slots
    return record


def apply_defaults(record):
    """把未导出 / 哨兵字段按协议默认值补齐（就地修改）。"""
    limit_break = record.setdefault("limitBreak", {})
    if limit_break.get("grade") is None:
        limit_break["grade"] = DEFAULTS["grade"]
    if limit_break.get("core") is None:
        limit_break["core"] = DEFAULTS["core"]
    if record.get("affection") is None:
        record["affection"] = DEFAULTS["affection"]
    if record.get("combat") is None:
        record["combat"] = DEFAULTS["combat"]
    skills = record.setdefault("skills", {})
    for key in ("skill1", "skill2", "burst"):
        if skills.get(key) is None:
            skills[key] = DEFAULTS["skill"]
    if record.get("cube") is None:
        record["cube"] = {"resourceId": DEFAULTS["cube"], "level": DEFAULTS["cubeLevel"]}
    if record.get("favoriteItem") is None:
        record["favoriteItem"] = {"rarity": DEFAULTS["favoriteRarity"],
                                  "level": DEFAULTS["favoriteLevel"], "resourceKey": None}
    record.setdefault("equipments", [[None, None, None] for _ in range(4)])
    return record


if __name__ == "__main__":
    print(decode_share_code("NKP2:AAIAAf8AyDIMgyDIMgyDIMico3eBv1Kqofi8fLDpodQAdL5M6YwAKnIUUA"))
```

## 12. 演进规则

1. **加字段**：只能往掩码的空位上加（8 位已用满，再加字段必须升主版本号）。
   新增整套载荷类型时，往 `payloadType` 上加新值（`2`、`3`…），旧 BOT 会明确报「不认识的类型」。
2. **加魔方 / 珍藏品**：往 `CUBE_IDS` / `FAVORITE_KEYS` **末尾追加**，旧序号保持不变。
3. **加角色**：什么都不用改。角色 id 直接写 `nameCode`，新角色自动可用。
4. **改字段位宽或含义**：必须升主版本号；旧版 BOT 会拒绝，不会硬解析。
5. **版本判断**：版本号**完全相等**才解析。次版本号变化同样表示布局变动（A3→A4 就是次版本号变化
   但布局不兼容的反例），所以不能用「主版本一致即可」来判断。
6. **校验失败**：CRC32 不匹配 → 提示「分享码已损坏，请重新复制」，不要尝试修复。

### 版本历史

| 版本 | 变更 |
| --- | --- |
| 0.1 | 首个版本：全二进制位打包、8 项可选字段、冻结三张字典。**已废弃**：9 bit 的 `nameCode−5000` 编不下 35 个低号角色；空值被当成 0 |
| 0.2 | 插入载荷类型字节；角色 id 改 13 bit 直接写 `nameCode`；条目数提到统一位置；空值判定修正；新增类型 1（表格配置） |
