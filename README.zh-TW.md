# nacre

> 一套柔和、有層次的 OpenWrt 25.12 LuCI 主題：採用 coralline 的 morning-haze 配色，側邊欄不搶戲，登入頁可以換成你自己的照片。

[English](./README.md)

<!-- 主視覺：從示範路由器截圖，絕不使用正式環境的畫面 -->

## 你會得到什麼

| | |
|---|---|
| **配色** | coralline 的 *morning-haze*：長春花藍、薰衣草、鼠尾草、沙金、赤陶色的粉彩，搭配墨色文字，數據用深板岩色。支援淺色、深色、跟隨系統。 |
| **版面** | 左側側邊欄，群組可以收合；在手機上會變成抽屜。分頁標籤是 pill 分段選單。 |
| **狀態列** | 總覽頁頂端有一條 coralline 風格的 pill 狀態列，依序顯示：主機、WAN、IPv6 前綴、負載、記憶體、連線數、WAN 即時流量、時鐘。只用 LuCI 原本的狀態頁就讀得到的資料，**不需要額外權限**。 |
| **登入頁** | 預設是層狀波紋背景，也可以換成你的照片。模糊、玻璃透明度和主色都可以調整。 |
| **字型** | 內建 Bricolage Grotesque、IBM Plex Sans、JetBrains Mono（OFL 授權），路由器不用連網也能正常顯示。中文使用系統字型。 |

nacre 建立在上游 bootstrap 主題的變數系統之上，所以 LuCI 的每一頁和每個外掛都會套到樣式。nacre 只在上面加了配色、字型和版面。

## 需求

- OpenWrt **25.12**（apk）。不支援 OpenWrt 24.10 以前的版本（opkg）。
- 任何架構皆可，套件是 `noarch`。

## 安裝

在路由器上以 root 執行：

```sh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/Nanako0129/nacre/main/install.sh)"
```

腳本會下載最新的 release，安裝 `luci-theme-nacre` 和 `luci-app-nacre-config`，切換成 nacre 前會先問你。加上 `-y` 就會直接切換：

```sh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/Nanako0129/nacre/main/install.sh)" -- -y
```

安裝本身不會自動切換主題。之後也可以在「系統 → 系統 → 語言與樣式」選擇 **nacre**。

> 套件沒有 OpenWrt 官方金鑰的簽章，所以要用 `apk add --allow-untrusted` 安裝。執行前請先讀過 `install.sh`。

## 設定

「系統 → nacre」可以設定色彩模式、主色、登入卡片的模糊與透明度，以及登入背景。

登入背景放在 `/www` 底下，所以**區網內任何人不用登入就看得到**，登入頁才能顯示它。照片上傳前會先在你的瀏覽器裡重新編碼成 JPEG，順便去掉位置等中繼資料。即便如此，還是不要用你不想讓訪客看到的照片。

## 移除

```sh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/Nanako0129/nacre/main/install.sh)" -- uninstall
```

會把 LuCI 切回 bootstrap，並移除兩個套件、已上傳的背景和設定。

## 名字的由來

**Nacre** 是珍珠層，也就是珍珠母，語源是阿拉伯文的 *naqqāra*，意思是「貝殼」。珠母貝不會把跑進殼裡的沙粒排掉，而是一層又一層地包上薄薄的光澤，直到粗糙的東西變成平滑、帶虹彩的東西。nacre 對 LuCI 做的是同一件事：路由器的每一頁都還在底下，只是被包進了柔和的層次裡。圖示就是那顆牡蠣，殼上的色帶就是那一層層的珍珠層。

它是 [coralline](https://github.com/Nanako0129/coralline) 的姊妹作。coralline 也是一種海洋生物分泌出來的礦物，而且 nacre 的配色就來自它。

## 建置

用 OpenWrt 25.12 SDK 建置（`luci.mk` 格式，`include $(TOPDIR)/feeds/luci/luci.mk`）。`tools/build.sh` 會透過 SSH 在原生 x86_64 的 SDK 上建置，需要的變數請見腳本內容。

## 授權

Apache-2.0，與 LuCI 相同。衍生自 `luci-theme-bootstrap`（© The LuCI Team）。內建字型採用 SIL Open Font License，授權檔放在 `luci-static/nacre/fonts/` 裡。
