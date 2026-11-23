# herdr-mods

我自己寫、覺得好用的 [Herdr](https://herdr.dev) mod。每個 mod 一個資料夾，結構照 Herdr 的分享格式：

```
<name>/
  RECIPE.md          給 agent 從零重建這個 mod 的說明
  mods/<name>/       mod 本體（main.js、mod.json）
```

## Mod 清單

| Mod | 用途 |
|---|---|
| [decisions](decisions/) | 右側「待決策」面板：列出各專案 session 開給我的決策，在面板上核准、選擇或駁回，結果寫回檔案並通知 session |

## 安裝與同步

Herdr 不會熱載入 symlink 的 mod 資料夾，所以 app 裡放的是實體複本，用 `./sync` 在兩邊複製。

```sh
./sync install            # repo → ~/.config/herdr-app/mods（新機器，或 git pull 之後）
./sync install decisions  # 只裝一個
./sync pull               # app → repo（在 app 裡改完 mod、commit 之前）
```

`install` 只複製 mod 本體。要讓 mod 出現在視窗上，還要照各 mod 的 `RECIPE.md` 把區塊加進自己的版面檔。

## 新增一個 mod

1. 在 `~/.config/herdr-app/mods/<name>/` 開發，存檔即熱載入，用 `herdr-app check` 檢查。
2. 在這個 repo 建 `<name>/mods/<name>/`（空資料夾即可），執行 `./sync pull <name>`。
3. 寫 `<name>/RECIPE.md`，把 mod 加進上面的清單。
