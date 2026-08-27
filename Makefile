# Build a Debian package for the panel dashboard and publish it to the 808
# apt repo — same pattern as the salt-808 package (see ~/git/salt/Makefile).
#
# Usage:
#   make deb                      # build (date-stamped version)
#   make deb VERSION=1.2.3        # explicit version
#   make publish                  # build + upload to the 808 apt repo
#   make publish VERSION=1.2.3
#   make clean
#
# Environment:
#   REPO_URL     — upload endpoint (default: http://apt.808.org/upload)
#   REPO_API_KEY — bearer token for upload auth (required for publish)
#
# Output lands in build/:
#   build/panel_<version>_all.deb

VERSION   ?= $(shell date +%Y%m%d.%H%M%S)
REPO_URL  ?= http://apt.808.org/upload
PKG       := panel
BUILD_DIR := build
STAGE     := $(BUILD_DIR)/$(PKG)_$(VERSION)_all
DEB       := $(STAGE).deb

.PHONY: all deb publish clean

all: deb

# Always rebuilds: the payload depends on the working tree, not just on the
# output file existing (a plain file target would skip when build/*.deb was
# already present from a prior run).
deb:
	rm -rf $(STAGE)
	mkdir -p $(STAGE)

	# 1. Build web + server from source.
	npm ci
	npm run build

	# 2. App payload under /opt/panel. node's module resolution walks up
	#    from server/dist to /opt/panel/node_modules, and the server
	#    resolves the web build relative to its own dir (../../web/build).
	mkdir -p $(STAGE)/opt/panel/server $(STAGE)/opt/panel/web
	cp -a server/dist $(STAGE)/opt/panel/server/dist
	cp -a web/build   $(STAGE)/opt/panel/web/build
	# Runtime deps only, installed standalone from the server workspace's
	# package.json so the deb doesn't carry the web build-time deps (fonts,
	# d3, elk). All prod deps are pure JS/wasm, so the package is arch:all.
	cp server/package.json $(STAGE)/opt/panel/package.json
	cd $(STAGE)/opt/panel && npm install --omit=dev --omit=optional \
		--no-audit --no-fund --ignore-scripts --no-package-lock

	# 3. Static packaging tree: maintainer scripts, systemd unit, env
	#    example. cp -a preserves the executable bits on the scripts.
	cp -a packaging/panel/DEBIAN $(STAGE)/DEBIAN
	mkdir -p $(STAGE)/lib/systemd/system $(STAGE)/usr/share/panel
	cp packaging/panel/lib/systemd/system/panel.service $(STAGE)/lib/systemd/system/
	cp packaging/panel/usr/share/panel/panel.env.example $(STAGE)/usr/share/panel/

	# 4. Stamp the version into the control file.
	sed -i 's/{{VERSION}}/$(VERSION)/' $(STAGE)/DEBIAN/control

	dpkg-deb --build --root-owner-group $(STAGE)
	@echo "  -> $(DEB)"

# ── publish ───────────────────────────────────────────────────────────────

publish: deb
ifndef REPO_API_KEY
	$(error REPO_API_KEY is not set — export it or pass on the command line)
endif
	curl -f -H "Authorization: Bearer $(REPO_API_KEY)" \
		--upload-file $(DEB) \
		$(REPO_URL)/$(PKG)_$(VERSION)_all.deb
	@echo ""
	@echo "Published $(PKG) $(VERSION) to $(REPO_URL)"

# ── clean ─────────────────────────────────────────────────────────────────

clean:
	rm -rf $(BUILD_DIR)
