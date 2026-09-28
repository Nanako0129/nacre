# nacre

> A soft, layered LuCI theme for OpenWrt 25.12 — coralline's morning-haze palette, a sidebar that stays out of the way, and a login page you can dress in your own photo.

[繁體中文說明](./README.zh-TW.md)

<!-- hero: rendered from a demo router, never from a production one -->

## What you get

| | |
|---|---|
| **Palette** | coralline's *morning-haze*: periwinkle, lavender, sage, sand and terracotta pastels with ink text, deep slate for data. Light, dark, or follow the system. |
| **Layout** | A left sidebar with collapsible groups; on phones it becomes a drawer. Tabs are a segmented pill bar. |
| **Status line** | On the overview page, a coralline-style pill run: host, WAN, IPv6 prefix, load, RAM, connections, live WAN throughput, clock. It only uses data LuCI's own status pages can already read — no extra permissions. |
| **Login page** | A layered strata background by default, or your own photo. Blur, glass opacity and the accent colour are adjustable. |
| **Fonts** | Bricolage Grotesque, IBM Plex Sans and JetBrains Mono are bundled (OFL), so the router needs no internet access to render them. CJK text uses the system font. |

Everything is built on the upstream bootstrap theme's variable system, so every LuCI page and app is styled — nacre only adds the palette, fonts and layout on top.

## Requirements

- OpenWrt **25.12** (apk). OpenWrt 24.10 and older (opkg) are not supported.
- Any architecture: the packages are `noarch`.

## Install

On the router, as root:

```sh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/Nanako0129/nacre/main/install.sh)"
```

The script downloads the latest release, installs `luci-theme-nacre` and `luci-app-nacre-config`, and asks before switching LuCI to nacre. Add `-y` to switch without asking:

```sh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/Nanako0129/nacre/main/install.sh)" -- -y
```

Installing never switches the theme on its own; you can also pick **nacre** later under *System → System → Language and Style*.

> The packages are not signed with an OpenWrt key, so they are installed with `apk add --allow-untrusted`. Read `install.sh` before running it.

## Settings

*System → nacre* holds the colour mode, the accent colour, the login card's blur and opacity, and the login background.

The login background is served from `/www`, so **anyone on your LAN can see it without logging in** — that is what lets the login page show it. Photos are re-encoded to JPEG in your browser before upload, which strips location and other metadata, but still don't use a picture you wouldn't show a guest.

## Uninstall

```sh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/Nanako0129/nacre/main/install.sh)" -- uninstall
```

This switches LuCI back to bootstrap and removes both packages, the uploaded background and the settings.

## The name

**Nacre** is mother-of-pearl, from the Arabic *naqqāra*, "shell". A pearl oyster doesn't remove the grit that gets inside it; it coats it, one thin layer of lustre after another, until the rough thing becomes the smooth, iridescent thing. nacre does the same to LuCI: the router's pages are all still there underneath, just wrapped in soft layers. The icon is that oyster, its shells banded like the layers themselves.

It is a sibling of [coralline](https://github.com/Nanako0129/coralline) — another mineral a sea creature lays down, and the source of nacre's palette.

## Building

The packages build with the OpenWrt 25.12 SDK (`luci.mk` layout, `include $(TOPDIR)/feeds/luci/luci.mk`). `tools/build.sh` drives a native x86_64 SDK over SSH; see the script for the variables it expects.

## Licence

Apache-2.0, like LuCI itself. Derived from `luci-theme-bootstrap` (© The LuCI Team). Bundled fonts are under the SIL Open Font License; their licence files sit next to them in `luci-static/nacre/fonts/`.
