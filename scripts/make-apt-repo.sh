#!/usr/bin/env bash
# Build (or rebuild) the apt repository tree under <repo-dir> from one or more
# .deb files in <debs-dir>. Idempotent: pool/ accumulates across releases;
# dists/ metadata is rebuilt from the whole pool on every run.
#
# Usage: bash scripts/make-apt-repo.sh <debs-dir> <repo-dir>
# Env:   APT_GPG_PRIVATE_KEY  armored secret key
#        APT_GPG_PASSPHRASE   may be empty (key generated without passphrase)
set -eu

DEBS_DIR=$1
REPO_DIR=$2

# Ephemeral gpg homedir; wiped on exit.
GNUPGHOME=$(mktemp -d)
export GNUPGHOME
OPTIONS=$(mktemp)
trap 'rm -rf "$GNUPGHOME" "$OPTIONS"' EXIT

printf '%s\n' "$APT_GPG_PRIVATE_KEY" | gpg --batch --import

for deb in "$DEBS_DIR"/*.deb; do
  install -Dm644 "$deb" "$REPO_DIR/pool/stable/main/s/sudonotes/$(basename "$deb")"
done

mkdir -p "$REPO_DIR/dists/stable/main/binary-amd64"

cd "$REPO_DIR"

apt-ftparchive packages pool > dists/stable/main/binary-amd64/Packages
gzip -9 -f -k dists/stable/main/binary-amd64/Packages

cat > "$OPTIONS" <<'EOF'
APT::FTPArchive::Release::Origin "sudonotes";
APT::FTPArchive::Release::Label "sudonotes";
APT::FTPArchive::Release::Suite "stable";
APT::FTPArchive::Release::Codename "stable";
APT::FTPArchive::Release::Architectures "amd64";
APT::FTPArchive::Release::Components "main";
EOF

apt-ftparchive -c "$OPTIONS" release dists/stable > dists/stable/Release

gpg --batch --yes --pinentry-mode loopback --passphrase "$APT_GPG_PASSPHRASE" \
  --digest-algo SHA512 --clearsign -o dists/stable/InRelease dists/stable/Release
gpg --batch --yes --pinentry-mode loopback --passphrase "$APT_GPG_PASSPHRASE" \
  --armor --detach-sign -o dists/stable/Release.gpg dists/stable/Release
