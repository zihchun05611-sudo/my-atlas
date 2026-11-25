# 足跡百科 My Atlas

A 3D interactive globe for recording places I've traveled to, with a cultural encyclopedia for each city: customs and taboos, local specialties, key history and useful local phrases.

可旋轉的 3D 地球，用來記錄自己去過、住過、想去的城市。點開城市就能看到當地的習俗禁忌、名產特色、經典歷史和實用的一句話。

## Features 功能

- 3D 地球：拖曳旋轉、滾輪縮放，點城市會自動飛過去
- 足跡標記：去過／住過／想去，用顏色顯示，資料存在瀏覽器裡
- 城市百科：簡介、習俗禁忌、名產特色、歷史年表、當地一句話，附資料來源
- 即時資料：從維基百科抓取城市摘要與照片
- 旅行速查：當地時間與時差、語言、貨幣、插座電壓、行車方向、小費、從桃園飛過去的距離
- 我的紀錄：造訪日期、評分、旅行筆記、照片（存在瀏覽器的 IndexedDB）
- 照片庫：依城市整理所有照片，可放大檢視
- 航線圖：從桃園機場畫出飛往去過城市的動態航線
- 統計：城市、國家、大洲數量與累積航程
- 搜尋與篩選：台灣／世界／去過／想去
- 手機版排版

## Coverage 收錄範圍

- 台灣 22 縣市
- 世界 17 座城市（持續增加中）

## Tech 技術

HTML · CSS · JavaScript · Wikipedia REST API · IndexedDB · [globe.gl](https://github.com/vasturiano/globe.gl)（Three.js／WebGL）· GitHub Pages

## Roadmap 開發計畫

- [x] 第 1 步：3D 地球、城市資訊卡、足跡標記
- [x] 第 2 步：串接維基百科摘要、國家旅行速查
- [x] 第 3 步：旅行筆記、照片庫、統計、航線弧線
- [ ] 第 4 步：帳號登入、使用者補充內容與審核、中英雙語介面
