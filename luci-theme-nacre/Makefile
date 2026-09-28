#
# Copyright (C) 2026 Nanako0129
# Derived from luci-theme-bootstrap, Copyright (C) 2008-2014 The LuCI Team
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_VERSION:=0.1.0
PKG_RELEASE:=3

LUCI_TITLE:=nacre theme
LUCI_DEPENDS:=+luci-base

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Nanako0129

# csstidy merges the three @font-face blocks into one (keeping only the last),
# silently dropping two of the bundled fonts. Ship the CSS unminified.
LUCI_MINIFY_CSS:=0

define Package/luci-theme-nacre/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	uci -q delete luci.themes.Nacre
	uci commit luci
}
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
