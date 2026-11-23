# herdr-mods

我替 [Herdr](https://herdr.dev)（給終端機與 coding agent 用的桌面 app）寫、而且每天在用的 mod。[English](README.md)

| Mod | 用途 |
|---|---|
| [decisions](decisions/README.zh-TW.md) | 側邊面板，集中列出各個 agent session 等你決定的事。可以核准、選擇選項，或附上原因駁回，結果會送回 session。 |

## 安裝

每個 mod 資料夾都照 Herdr 的分享格式，可以把資料夾網址交給 agent 請它安裝，或自己複製：

```sh
git clone https://github.com/joecwu/herdr-mods.git
cd herdr-mods
./sync install decisions
```

`./sync install` 會把 mod 複製到 `~/.config/herdr-app/mods/`（或 `$HERDR_APP_HOME/mods/`），並執行 `herdr-app check`。
mod 要放進版面才會出現在視窗上，各 mod 的 README 有要加的區塊。

## 目錄結構

```
<mod>/
  README.md        用途與設定方式
  RECIPE.md        讓 agent 從零重建這個 mod 的說明
  preview.png
  mods/<mod>/      mod 本體
  test/            純邏輯模組的單元測試
sync               在這個 repo 和執行中的 app 之間複製 mod
```

## 開發

Herdr 在 mod 資料夾內的檔案存檔時會熱載入，但資料夾是 symlink 時不會。所以 mod 直接在 app 的資料夾裡改，再複製回來：

```sh
$EDITOR ~/.config/herdr-app/mods/decisions/main.js   # 存檔即重新載入
herdr-app check ~/.config/herdr-app/mods/decisions   # 載入並渲染一次
./sync pull decisions                                # app → repo
npm test                                             # 需要 Node 22 以上，沒有相依套件
```

不需要 Herdr API 的邏輯放在獨立模組（例如 `decision-file.js`），用 `node --test` 測試；`main.js` 只放畫面。

## 授權

[MIT](LICENSE)
