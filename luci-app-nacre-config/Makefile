#
# Copyright (C) 2026 Nanako0129
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_VERSION:=0.2.1
PKG_RELEASE:=1

LUCI_TITLE:=Settings for the nacre theme
LUCI_DEPENDS:=+luci-theme-nacre
LUCI_PKGARCH:=all

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Nanako0129

# luci.mk names translation packages after the app's basename; the po also
# covers the theme's own strings, so publish it as luci-i18n-nacre-<lang>.
LUCI_BASENAME:=nacre

# luci.mk declares no conffiles; without this an upgrade overwrites settings.
define Package/luci-app-nacre-config/conffiles
/etc/config/nacre
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
